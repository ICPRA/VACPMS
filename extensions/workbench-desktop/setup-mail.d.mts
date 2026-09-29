export function setupMail(input: { home: string; runtime: { executable: string; config: string }; credential: string }, signal?: AbortSignal): Promise<{ configured: boolean; reused: boolean }>;
