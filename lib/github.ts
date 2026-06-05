// Lightweight GitHub API client for committing files atomically via the
// Git Data API. Used by /api/admin/publish to push a hero photo + a
// markdown post in a single commit so Vercel only triggers one rebuild.
//
// Uses fetch directly — no SDK. Authenticates with a personal-access
// token (PAT) in GITHUB_TOKEN with `repo` scope.

const GITHUB_API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string
  ) {
    super(message);
  }
}

interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
}

function getConfig(): RepoConfig {
  const owner = process.env.GITHUB_OWNER ?? "colporteur";
  const repo = process.env.GITHUB_REPO ?? "found-in-alabama";
  const branch = process.env.GITHUB_BRANCH ?? "main";
  return { owner, repo, branch };
}

function token(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) {
    throw new Error(
      "GITHUB_TOKEN is not set. Add a GitHub personal-access-token with `repo` scope to .env.local and Vercel env vars."
    );
  }
  return t;
}

async function ghFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GitHubError(
      `GitHub ${init.method ?? "GET"} ${path} returned ${res.status}`,
      res.status,
      text
    );
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/**
 * Check whether a path already exists on the configured branch. Used to
 * prevent accidentally overwriting an existing post when publishing.
 */
export async function pathExists(repoPath: string): Promise<boolean> {
  const { owner, repo, branch } = getConfig();
  try {
    await ghFetch(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(repoPath)}?ref=${branch}`
    );
    return true;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return false;
    throw err;
  }
}

interface FileToCommit {
  /** Repo-relative path, e.g. "content/posts/anniston-doctor-estate.md" */
  path: string;
  /** Raw file content. For binary files, pass base64-encoded string. */
  content: string;
  /** Is the content already base64? Default false (treats as utf-8). */
  isBase64?: boolean;
}

/**
 * Commit one or more files to the configured branch in a single atomic
 * commit. Uses the Git Data API:
 *   1. Get current branch tip (commit SHA + tree SHA)
 *   2. Create blobs for each file
 *   3. Create a new tree referencing the base tree + new blobs
 *   4. Create a commit pointing at the new tree
 *   5. Fast-forward the branch ref to the new commit
 *
 * Returns the new commit's SHA and HTML URL.
 */
export async function commitFiles(
  files: FileToCommit[],
  message: string
): Promise<{ commitSha: string; commitUrl: string }> {
  const { owner, repo, branch } = getConfig();

  // 1. Get the current branch tip
  const ref = await ghFetch<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`
  );
  const baseCommitSha = ref.object.sha;

  const baseCommit = await ghFetch<{ tree: { sha: string } }>(
    `/repos/${owner}/${repo}/git/commits/${baseCommitSha}`
  );
  const baseTreeSha = baseCommit.tree.sha;

  // 2. Create blobs
  const blobs = await Promise.all(
    files.map(async (f) => {
      const blob = await ghFetch<{ sha: string }>(
        `/repos/${owner}/${repo}/git/blobs`,
        {
          method: "POST",
          body: JSON.stringify({
            content: f.isBase64 ? f.content : Buffer.from(f.content).toString("base64"),
            encoding: "base64",
          }),
        }
      );
      return { path: f.path, sha: blob.sha };
    })
  );

  // 3. Create new tree
  const newTree = await ghFetch<{ sha: string }>(
    `/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: blobs.map((b) => ({
          path: b.path,
          mode: "100644",
          type: "blob",
          sha: b.sha,
        })),
      }),
    }
  );

  // 4. Create commit
  const newCommit = await ghFetch<{ sha: string; html_url: string }>(
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: newTree.sha,
        parents: [baseCommitSha],
      }),
    }
  );

  // 5. Update the branch ref
  await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });

  return { commitSha: newCommit.sha, commitUrl: newCommit.html_url };
}
