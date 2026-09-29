import type { ReviewSource } from "./workbenchModel";

export function ReviewSourceFields({ source, slug, labelPrefix, language, disabled, onChange }: {
  source: ReviewSource; slug: string; labelPrefix: string; language: "zh" | "en";
  disabled?: boolean; onChange: (source: ReviewSource) => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  return <>
    <label>{text("来源类型", "Source kind")}<select aria-label={`${labelPrefix} kind`} disabled={disabled} value={source.kind} onChange={(event) => onChange(event.target.value === "specgraph"
      ? { kind: "specgraph", specSlug: slug, field: "", changeId: "" }
      : { kind: "git", environmentId: "", repositoryRoot: "", commitSha: "", path: "" })}>
      <option value="specgraph">SpecGraph</option><option value="git">Git</option>
    </select></label>
    {(source.kind === "specgraph" ? [
      ["specSlug", text("来源节点", "Source node")], ["field", text("字段", "Field")], ["changeId", text("原始变更 ID", "Original change ID")],
    ] as const : [
      ["environmentId", text("环境 ID", "Environment ID")], ["repositoryRoot", text("仓库路径", "Repository root")], ["commitSha", text("固定提交 SHA", "Exact commit SHA")], ["path", text("文件路径", "File path")], ["entry", text("条目（可选）", "Entry (optional)")],
    ] as const).map(([field, label]) => <label key={field} className="block">{label}<input aria-label={`${labelPrefix} ${field}`} className="w-full min-w-0" disabled={disabled} required={field !== "entry"} maxLength={2000}
      value={(source as Record<string, string>)[field] ?? ""} onChange={(event) => onChange({ ...source, [field]: event.target.value })} /></label>)}
  </>;
}
