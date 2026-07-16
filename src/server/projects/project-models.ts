import type {
  ProjectSnapshot,
  RegisteredProject,
  SnapshotDiagnostic,
} from "../storage/models.js";

/** 已通过结构校验的 Trellis 项目。 */
export interface ValidatedTrellisProject {
  id: string;
  projectRoot: string;
  trellisRoot: string;
  label: string;
}

/** 单项目结构校验结果。 */
export interface ProjectValidationResult {
  valid: boolean;
  project: ValidatedTrellisProject | null;
  diagnostics: SnapshotDiagnostic[];
}

/** 扫描得到但尚未持久化的项目候选。 */
export interface ProjectDiscoveryCandidate {
  project: RegisteredProject;
  snapshot: ProjectSnapshot;
}

/** 一次扫描的候选项目和扫描级诊断。 */
export interface ProjectScanResult {
  candidates: ProjectDiscoveryCandidate[];
  diagnostics: SnapshotDiagnostic[];
}

/** 项目登记结果。 */
export interface ProjectRegistrationResult {
  status: "added" | "updated" | "invalid";
  project: RegisteredProject | null;
  snapshot: ProjectSnapshot | null;
  diagnostics: SnapshotDiagnostic[];
}

/** 已登记项目重新校验和索引后的结果。 */
export interface ProjectRefreshResult {
  status: "refreshed" | "unavailable" | "not-found";
  project: RegisteredProject | null;
  snapshot: ProjectSnapshot | null;
  diagnostics: SnapshotDiagnostic[];
}

/** 按需读取的 Markdown 正文。 */
export interface ProjectMarkdownDocument {
  content: string;
  sourcePath: string;
  modifiedAt: string;
}

/** 受保护路径不满足项目读取边界。 */
export class UnsafeProjectPathError extends Error {
  /** 创建项目路径边界错误。 */
  constructor(message: string) {
    super(message);
    this.name = "UnsafeProjectPathError";
  }
}
