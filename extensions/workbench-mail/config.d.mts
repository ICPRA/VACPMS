export type MailConfig = ({ readonly endpoint: string } | { readonly executable: string; readonly config: string }) & {
  readonly token: string;
  readonly projects: Readonly<Record<string, string>>;
};
export function loadMailConfig(path: string | undefined, read?: (path: string, encoding: "utf8") => string): MailConfig | undefined;
