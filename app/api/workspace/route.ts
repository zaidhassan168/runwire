import { eq } from 'drizzle-orm';
import { getChatGPTUser } from '../../chatgpt-auth';
import { ensureSchema, getDb } from '../../../db';
import { workspaces } from '../../../db/schema';

const MAX_WORKSPACE_BYTES = 512_000;

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ state: null, updatedAt: null, user: null });

  await ensureSchema();
  const [workspace] = await getDb()
    .select({ stateJson: workspaces.stateJson, updatedAt: workspaces.updatedAt })
    .from(workspaces)
    .where(eq(workspaces.ownerId, user.userId))
    .limit(1);

  return Response.json({
    state: workspace ? JSON.parse(workspace.stateJson) : null,
    updatedAt: workspace?.updatedAt ?? null,
    user: { displayName: user.displayName, email: user.email },
  });
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in to save your workspace.' }, { status: 401 });

  let state: unknown;
  try {
    state = await request.json();
  } catch {
    return Response.json({ error: 'Workspace payload must be valid JSON.' }, { status: 400 });
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return Response.json({ error: 'Workspace payload must be an object.' }, { status: 400 });
  }

  const stateJson = JSON.stringify(state);
  if (new TextEncoder().encode(stateJson).byteLength > MAX_WORKSPACE_BYTES) {
    return Response.json({ error: 'Workspace exceeds the 512 KB limit.' }, { status: 413 });
  }

  await ensureSchema();
  const updatedAt = new Date();
  await getDb()
    .insert(workspaces)
    .values({ ownerId: user.userId, stateJson, updatedAt })
    .onConflictDoUpdate({
      target: workspaces.ownerId,
      set: { stateJson, updatedAt },
    });

  return Response.json({ saved: true, updatedAt });
}
