import { randomUUID } from "node:crypto";
import { open, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { ZodType } from "zod";

/** 损坏文件恢复后留下的审计信息。 */
export interface StorageRecovery {
  filePath: string;
  backupPath: string;
  reason: "invalid-json" | "invalid-structure";
  message: string;
}

/** 单次读取的结果和可能发生的恢复记录。 */
export interface StorageLoadResult<T> {
  data: T;
  created: boolean;
  recovery: StorageRecovery | null;
}

interface VersionedData {
  version: number;
}

interface JsonFileStoreOptions<T extends VersionedData> {
  filePath: string;
  currentVersion: number;
  schema: ZodType<T>;
  createDefault: () => T;
}

/** 数据文件版本不受当前程序支持。 */
export class UnsupportedStorageVersionError extends Error {
  /**
   * 创建版本不兼容错误。
   *
   * @param filePath 数据文件路径
   * @param actualVersion 文件中的版本
   * @param expectedVersion 当前程序支持的版本
   */
  constructor(
    public readonly filePath: string,
    public readonly actualVersion: number,
    public readonly expectedVersion: number,
  ) {
    super(`数据文件版本不兼容：当前为 ${actualVersion}，期望为 ${expectedVersion}`);
    this.name = "UnsupportedStorageVersionError";
  }
}

/** 提供版本校验、损坏恢复和原子写入的 JSON 文件存储。 */
export class JsonFileStore<T extends VersionedData> {
  private writeQueue: Promise<void> = Promise.resolve();

  /** 创建版本化 JSON 文件存储。 */
  constructor(private readonly options: JsonFileStoreOptions<T>) {}

  /**
   * 加载并校验数据文件，缺失或损坏时按合同恢复。
   *
   * @returns 合法数据、创建标记和恢复记录
   */
  async load(): Promise<StorageLoadResult<T>> {
    await this.writeQueue;

    let content: string;
    try {
      content = await readFile(this.options.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        const data = this.options.createDefault();
        await this.save(data);
        return { data, created: true, recovery: null };
      }

      throw error;
    }

    let unknownData: unknown;
    try {
      unknownData = JSON.parse(content) as unknown;
    } catch (error) {
      return this.recover("invalid-json", getErrorMessage(error));
    }

    const actualVersion = readNumericVersion(unknownData);
    if (actualVersion !== null && actualVersion !== this.options.currentVersion) {
      throw new UnsupportedStorageVersionError(
        this.options.filePath,
        actualVersion,
        this.options.currentVersion,
      );
    }

    const parsed = this.options.schema.safeParse(unknownData);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
      return this.recover("invalid-structure", message);
    }

    return { data: parsed.data, created: false, recovery: null };
  }

  /**
   * 校验并按调用顺序保存数据。
   *
   * @param data 待保存的完整文件数据
   */
  async save(data: T): Promise<void> {
    const validatedData = this.options.schema.parse(data);
    const operation = this.writeQueue.then(() => this.writeAtomically(validatedData));

    // 队列本身保持可继续使用，单次调用仍会收到真实写入错误。
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  /** 将损坏文件隔离后恢复默认数据。 */
  private async recover(
    reason: StorageRecovery["reason"],
    message: string,
  ): Promise<StorageLoadResult<T>> {
    const backupPath = createCorruptBackupPath(this.options.filePath);

    // 原文件先被保留为隔离副本，只有隔离成功后才写入新的默认文件。
    await rename(this.options.filePath, backupPath);
    const data = this.options.createDefault();
    await this.save(data);

    return {
      data,
      created: false,
      recovery: {
        filePath: this.options.filePath,
        backupPath,
        reason,
        message,
      },
    };
  }

  /** 使用同目录临时文件和原子重命名完成一次写入。 */
  private async writeAtomically(data: T): Promise<void> {
    const directory = dirname(this.options.filePath);
    const temporaryPath = join(
      directory,
      `.${basename(this.options.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );

    await mkdir(directory, { recursive: true, mode: 0o700 });
    let fileHandle: Awaited<ReturnType<typeof open>> | null = null;

    try {
      fileHandle = await open(temporaryPath, "wx", 0o600);
      await fileHandle.writeFile(`${JSON.stringify(data, null, 2)}\n`, "utf8");
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = null;
      await rename(temporaryPath, this.options.filePath);
    } finally {
      if (fileHandle !== null) {
        await fileHandle.close().catch(() => undefined);
      }
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

/** 从未知 JSON 根对象中读取数值版本。 */
function readNumericVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("version" in value)) {
    return null;
  }

  const version = (value as { version?: unknown }).version;
  return typeof version === "number" ? version : null;
}

/** 生成跨平台安全且不冲突的损坏文件备份名。 */
function createCorruptBackupPath(filePath: string): string {
  const extension = extname(filePath);
  const fileName = basename(filePath, extension);
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "");
  return join(dirname(filePath), `${fileName}.corrupt-${timestamp}-${randomUUID()}${extension}`);
}

/** 判断未知错误是否包含 Node.js 文件系统错误码。 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** 提取可记录的错误消息。 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
