'use client';
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown, ArrowsClockwise, BracketsCurly, CaretDown, Check, CheckCircle, Clock,
  Circle, CloudArrowDown, CloudArrowUp, Code, Copy, DotsThreeVertical, DownloadSimple,
  FloppyDisk, GearSix, Lightning, List, MagnifyingGlass, Play, Plus, Pulse,
  Robot, SlidersHorizontal, TerminalWindow, Trash,
  WarningCircle, X, XCircle,
} from '@phosphor-icons/react';
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoLayoutJourney, buildJourneyEdges, fitJourneyViewport, FLOW_NODE_WIDTH, flowEdgePath, JourneyFlowEdge, JourneyNodePosition, moveJourneyNode, normalizeJourneyPositions } from '../lib/flow';
import { JourneyStep, JourneyStepResult, runJourneySequence } from '../lib/journey';
import { ApiCollection, exportPostmanCollection, importPostmanCollection } from '../lib/postman';
import { agentToolOutputFailed, applyRequestAuth, EnvironmentVariable, isLocalRequestUrl, isRequestAuthConfigured, isSensitiveVariableKey, mergeEnvironmentVariables, protectSensitiveHeaders, RequestAuth, requiresAgentApproval, resolveTemplate, summarizeAgentToolInput, withoutSensitiveHeaders } from '../lib/workspace';

type View = 'requests' | 'journeys' | 'runs';
type JourneyMode = 'map' | 'list';
type FlowId = 'checkout' | 'tickets';
type EditorTab = 'Params' | 'Auth' | 'Headers' | 'Body' | 'Tests';
type ApiResponse = { requestUrl: string; requestBody?: string; status: number; statusText: string; headers: [string, string][]; body: string; durationMs: number; sizeBytes: number; truncated: boolean };
type FlowDefinition = { id: FlowId; name: string; collection: string; description: string; steps: JourneyStep[] };
type RunRecord = { id: string; flowId: FlowId; flowName: string; steps: JourneyStep[]; startedAt: string; status: 'passed' | 'failed'; durationMs: number; results: JourneyStepResult[] };
type BurstResult = { count: number; successRate: number; p50: number; p95: number; errors: number };
type AgentToolEvent = { id: string; name: string; title: string; input: string; status: 'waiting' | 'running' | 'passed' | 'failed' | 'denied'; startedAt: number; durationMs?: number };
type PendingAgentApproval = Pick<AgentToolEvent, 'id' | 'name' | 'title' | 'input'>;
type WebMcpTool = Parameters<NonNullable<Document['modelContext']>['registerTool']>[0];
type SavedWorkspace = {
  activeRequest: { method: string; url: string; body: string; headers?: [string, string][]; name?: string; collection?: string };
  environment: { name: string; variables: EnvironmentVariable[] };
  importedCollections?: ApiCollection[];
  assertions?: { expectedStatus: number; maxDurationMs: number };
  journeyRepaired?: boolean;
  activeFlowId?: FlowId;
  journeyPositions?: JourneyNodePosition[];
};

const defaultHeaders: [string, string][] = [['Accept', 'application/json']];
const defaultEnvironment: EnvironmentVariable[] = [{ key: 'demoOrderId', value: 'ord_demo_01' }, { key: 'demoTicketId', value: 'tkt_demo_01' }];
const starterCollections: ApiCollection[] = [{
  id: 'checkout', name: 'Checkout API', requests: [
    { id: 'create-customer', name: 'Create customer', method: 'POST', url: '/api/demo?action=create_customer', headers: [['Content-Type', 'application/json']], body: '{\n  "name": "Ada Lovelace"\n}' },
    { id: 'create-order', name: 'Create order', method: 'POST', url: '/api/demo?action=create_order', headers: [['Content-Type', 'application/json']], body: '{\n  "customerId": "cus_demo_01",\n  "items": [{ "sku": "journey-notebook", "quantity": 2 }]\n}' },
    { id: 'get-order', name: 'Get order', method: 'GET', url: '/api/demo?action=get_order&id={{demoOrderId}}', headers: defaultHeaders, body: '' },
    { id: 'delete-order', name: 'Delete order', method: 'DELETE', url: '/api/demo?action=delete_order&id={{demoOrderId}}', headers: defaultHeaders, body: '' },
  ],
}, {
  id: 'tickets', name: 'Ticket API', requests: [
    { id: 'create-ticket', name: 'Create ticket', method: 'POST', url: '/api/demo?action=create_ticket', headers: [['Content-Type', 'application/json']], body: '{\n  "subject": "Cannot sign in after MFA",\n  "priority": "high"\n}' },
    { id: 'get-ticket', name: 'Get ticket', method: 'GET', url: '/api/demo?action=get_ticket&id={{demoTicketId}}', headers: defaultHeaders, body: '' },
    { id: 'close-ticket', name: 'Close ticket', method: 'PATCH', url: '/api/demo?action=close_ticket&id={{demoTicketId}}', headers: [['Content-Type', 'application/json']], body: '{\n  "resolution": "Reset trusted device"\n}' },
  ],
}];

function buildFlow(id: FlowId, repaired: boolean): FlowDefinition {
  if (id === 'tickets') return {
    id, name: 'Ticket lifecycle', collection: 'Ticket API', description: 'Create a support ticket, pass its ID into a lookup, then close it.', steps: [
      { id: 'create-ticket', label: 'Create ticket', method: 'POST', url: '/api/demo?action=create_ticket', expectedStatus: 201, headers: [['Content-Type', 'application/json']], body: '{"subject":"Cannot sign in after MFA","priority":"high"}', extracts: [{ key: 'ticketId', path: '$.id' }] },
      { id: 'get-ticket', label: 'Get ticket', method: 'GET', url: '/api/demo?action=get_ticket&id={{ticketId}}', expectedStatus: 200, headers: defaultHeaders },
      { id: 'close-ticket', label: 'Close ticket', method: 'PATCH', url: '/api/demo?action=close_ticket&id={{ticketId}}', expectedStatus: 200, headers: [['Content-Type', 'application/json']], body: '{"resolution":"Reset trusted device"}' },
    ],
  };
  return {
    id, name: 'Checkout recovery', collection: 'Checkout API', description: 'Create a customer and order, verify the order, then clean it up.', steps: [
      { id: 'create-customer', label: 'Create customer', method: 'POST', url: '/api/demo?action=create_customer', expectedStatus: 201, headers: [['Content-Type', 'application/json']], body: '{"name":"Ada Lovelace"}', extracts: [{ key: 'customerId', path: '$.id' }] },
      { id: 'create-order', label: 'Create order', method: 'POST', url: '/api/demo?action=create_order', expectedStatus: 201, headers: repaired ? [['Content-Type', 'application/json'], ['Idempotency-Key', '{{$uuid}}']] : [['Content-Type', 'application/json']], body: '{"customerId":"{{customerId}}","items":[{"sku":"journey-notebook","quantity":2}]}', extracts: [{ key: 'orderId', path: '$.id' }, { key: 'customerId', path: '$.customerId' }] },
      { id: 'get-order', label: 'Get order', method: 'GET', url: '/api/demo?action=get_order&id={{orderId}}&customerId={{customerId}}', expectedStatus: 200, headers: defaultHeaders },
      { id: 'delete-order', label: 'Delete order', method: 'DELETE', url: '/api/demo?action=delete_order&id={{orderId}}', expectedStatus: 204, headers: defaultHeaders },
    ],
  };
}

function methodClass(method: string) { return `method method-${method.toLowerCase()}`; }
function percentile(values: number[], fraction: number) { return values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : 0; }
function formatPayload(value = '') { if (!value) return 'No body'; try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
function resolveRequestAuth(auth: RequestAuth, render: (value: string) => string): RequestAuth {
  if (auth.type === 'bearer') return { ...auth, token: render(auth.token) };
  if (auth.type === 'basic') return { ...auth, username: render(auth.username), password: render(auth.password) };
  if (auth.type === 'api-key') return { ...auth, key: render(auth.key), value: render(auth.value) };
  return auth;
}

export default function Home() {
  const [view, setView] = useState<View>('requests');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('/api/demo?action=get_order&id={{demoOrderId}}');
  const [body, setBody] = useState('');
  const [headers, setHeaders] = useState<[string, string][]>(defaultHeaders);
  const [auth, setAuth] = useState<RequestAuth>({ type: 'none' });
  const [requestName, setRequestName] = useState('Get order');
  const [collectionName, setCollectionName] = useState('Checkout API');
  const [importedCollections, setImportedCollections] = useState<ApiCollection[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [environmentName, setEnvironmentName] = useState('Local sandbox');
  const [variables, setVariables] = useState<EnvironmentVariable[]>(defaultEnvironment);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeEditorTab, setActiveEditorTab] = useState<EditorTab>('Tests');
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [responseTab, setResponseTab] = useState<'Body' | 'Headers'>('Body');
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [maxDurationMs, setMaxDurationMs] = useState(15000);
  const [requestError, setRequestError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [journeyRepaired, setJourneyRepaired] = useState(false);
  const [activeFlowId, setActiveFlowId] = useState<FlowId>('checkout');
  const [journeyMode, setJourneyMode] = useState<JourneyMode>('map');
  const [selectedStepId, setSelectedStepId] = useState('create-order');
  const [journeyPositions, setJourneyPositions] = useState<JourneyNodePosition[]>(() => autoLayoutJourney(buildFlow('checkout', false).steps));
  const [journeyResults, setJourneyResults] = useState<JourneyStepResult[]>([]);
  const [isJourneyRunning, setIsJourneyRunning] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [burstCount, setBurstCount] = useState(25);
  const [burstConcurrency, setBurstConcurrency] = useState(5);
  const [burstResult, setBurstResult] = useState<BurstResult | null>(null);
  const [isBurstRunning, setIsBurstRunning] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<'guest' | 'cloud'>('guest');
  const [userInitials, setUserInitials] = useState('··');
  const [agentTraceOpen, setAgentTraceOpen] = useState(false);
  const [agentEvents, setAgentEvents] = useState<AgentToolEvent[]>([]);
  const [webMcpReady, setWebMcpReady] = useState(false);
  const [pendingAgentApproval, setPendingAgentApproval] = useState<PendingAgentApproval | null>(null);
  const agentApprovalResolver = useRef<((approved: boolean) => void) | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const activeFlow = useMemo(() => buildFlow(activeFlowId, journeyRepaired), [activeFlowId, journeyRepaired]);
  const journeySteps = activeFlow.steps;
  const journeyEdges = useMemo(() => buildJourneyEdges(journeySteps), [journeySteps]);
  const selectedStep = journeySteps.find((step) => step.id === selectedStepId) ?? journeySteps[0];
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const allCollections = useMemo(() => [...starterCollections, ...importedCollections], [importedCollections]);
  const visibleCollections = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return allCollections;
    return allCollections.map((collection) => ({ ...collection, requests: collection.requests.filter((request) => `${collection.name} ${request.name} ${request.method}`.toLowerCase().includes(query)) })).filter((collection) => collection.requests.length);
  }, [allCollections, filterQuery]);
  const formattedBody = useMemo(() => { const content = response?.body ?? ''; try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; } }, [response]);
  const assertionResults = response ? [{ label: `Status is ${expectedStatus}`, passed: response.status === expectedStatus }, { label: `Under ${maxDurationMs} ms`, passed: response.durationMs < maxDurationMs }] : [];

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/workspace').then(async (result) => {
      if (result.status === 401) { setUserInitials('G'); return; }
      if (!result.ok) throw new Error('Workspace could not be loaded.');
      const payload = await result.json() as { state: SavedWorkspace | null; user?: { displayName: string } | null };
      if (cancelled) return;
      if (payload.user?.displayName) {
        setWorkspaceMode('cloud');
        setUserInitials(payload.user.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase());
      } else setUserInitials('G');
      const saved = payload.state;
      const isLegacyStarter = saved?.activeRequest?.name === 'Get product 7'
        && saved.activeRequest.url === '{{baseUrl}}/objects/7'
        && saved.activeRequest.collection === 'Catalog';
      if (saved?.activeRequest && !isLegacyStarter) {
        setMethod(saved.activeRequest.method); setUrl(saved.activeRequest.url); setBody(saved.activeRequest.body ?? '');
        setHeaders(saved.activeRequest.headers?.length ? saved.activeRequest.headers : defaultHeaders);
        if (saved.activeRequest.name) setRequestName(saved.activeRequest.name);
        if (saved.activeRequest.collection) setCollectionName(saved.activeRequest.collection);
      }
      if (saved?.environment) { setEnvironmentName(saved.environment.name); setVariables(mergeEnvironmentVariables(defaultEnvironment, saved.environment.variables)); }
      if (saved?.importedCollections) setImportedCollections(saved.importedCollections);
      if (saved?.assertions) { setExpectedStatus(saved.assertions.expectedStatus); setMaxDurationMs(saved.assertions.maxDurationMs); }
      if (saved?.journeyRepaired) setJourneyRepaired(true);
      const savedFlowId: FlowId = saved?.activeFlowId === 'tickets' ? 'tickets' : 'checkout';
      const savedFlow = buildFlow(savedFlowId, Boolean(saved?.journeyRepaired));
      setActiveFlowId(savedFlowId);
      setSelectedStepId(savedFlow.steps[0].id);
      if (saved?.journeyPositions) setJourneyPositions(normalizeJourneyPositions(savedFlow.steps, saved.journeyPositions));
    }).catch(() => setSaveStatus('error')).finally(() => { if (!cancelled) setWorkspaceReady(true); });
    return () => { cancelled = true; };
  }, []);

  const requestAgentApproval = useCallback((approval: PendingAgentApproval) => new Promise<boolean>((resolve) => {
    if (agentApprovalResolver.current) { resolve(false); return; }
    agentApprovalResolver.current = resolve;
    setPendingAgentApproval(approval);
  }), []);

  const respondToAgentApproval = useCallback((approved: boolean) => {
    const resolve = agentApprovalResolver.current;
    agentApprovalResolver.current = null;
    setPendingAgentApproval(null);
    resolve?.(approved);
  }, []);

  useEffect(() => () => {
    agentApprovalResolver.current?.(false);
    agentApprovalResolver.current = null;
  }, []);

  const render = useCallback((input: string, runtime: Record<string, string> = {}) => {
    const builtins = { $uuid: crypto.randomUUID(), ...runtime };
    return resolveTemplate(input, [...variables, ...Object.entries(builtins).map(([key, value]) => ({ key, value }))]);
  }, [variables]);

  const executeRequest = useCallback(async (request: { method: string; url: string; headers?: [string, string][]; body?: string; auth?: RequestAuth }, runtime: Record<string, string> = {}) => {
    const resolvedUrl = render(request.url, runtime);
    const resolvedHeaders = (request.headers ?? []).filter(([key]) => key.trim()).map(([key, value]) => [key, render(value, runtime)] as [string, string]);
    const resolvedBody = request.body ? render(request.body, runtime) : '';
    const resolvedAuth = request.auth ? resolveRequestAuth(request.auth, (value) => render(value, runtime)) : { type: 'none' } as RequestAuth;
    const localRequest = isLocalRequestUrl(resolvedUrl);
    const authorized = applyRequestAuth(resolvedUrl, resolvedHeaders, resolvedAuth);
    if (!localRequest) {
      const result = await fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: request.method, url: authorized.url, headers: authorized.headers, body: resolvedBody }) });
      if (result.status === 401) { window.location.assign('/signin-with-chatgpt?return_to=/'); throw new Error('Sign in required.'); }
      const payload = await result.json() as ApiResponse & { error?: string };
      if (!result.ok || payload.error) throw new Error(payload.error ?? 'Request failed.');
      return { ...payload, requestBody: resolvedBody };
    }
    const startedAt = performance.now();
    const result = await fetch(authorized.url, { method: request.method, headers: Object.fromEntries(authorized.headers), body: ['GET', 'HEAD'].includes(request.method) ? undefined : resolvedBody || undefined });
    if (result.status === 401) { window.location.assign('/signin-with-chatgpt?return_to=/'); throw new Error('Sign in required.'); }
    const responseBody = await result.text();
    return { requestUrl: authorized.url, requestBody: resolvedBody, status: result.status, statusText: result.statusText, headers: [...result.headers.entries()], body: responseBody, durationMs: Math.max(1, Math.round(performance.now() - startedAt)), sizeBytes: new TextEncoder().encode(responseBody).byteLength, truncated: false } satisfies ApiResponse;
  }, [render]);

  const sendRequest = useCallback(async (event?: FormEvent) => {
    event?.preventDefault(); if (!workspaceReady) return null;
    setIsSending(true); setRequestError('');
    try { const result = await executeRequest({ method, url, headers, body, auth }); setResponse(result); setResponseTab('Body'); return result; }
    catch (error) { setResponse(null); setRequestError(error instanceof Error ? error.message : 'Request failed.'); return null; }
    finally { setIsSending(false); }
  }, [auth, body, executeRequest, headers, method, url, workspaceReady]);

  const runJourneySteps = useCallback(async (steps: JourneyStep[]) => {
    if (!workspaceReady || isJourneyRunning) return [];
    setView('journeys'); setIsJourneyRunning(true); setJourneyResults([]); setRequestError('');
    const started = performance.now();
    try {
      const results = await runJourneySequence(steps, (step, runtime) => executeRequest(step, runtime), setJourneyResults);
      const run: RunRecord = { id: crypto.randomUUID(), flowId: activeFlow.id, flowName: activeFlow.name, steps, startedAt: new Date().toISOString(), status: results.length === steps.length && results.every((result) => result.status === 'passed') ? 'passed' : 'failed', durationMs: Math.round(performance.now() - started), results };
      setRuns((current) => [run, ...current].slice(0, 20)); setSelectedRunId(run.id);
      const failed = results.find((result) => result.status === 'failed');
      if (failed) { setSelectedStepId(failed.id); setInspectorOpen(true); }
      return results;
    } catch (error) { setRequestError(error instanceof Error ? error.message : 'Flow failed.'); return []; }
    finally { setIsJourneyRunning(false); }
  }, [activeFlow.id, activeFlow.name, executeRequest, isJourneyRunning, workspaceReady]);

  const runJourney = useCallback(() => runJourneySteps(journeySteps), [journeySteps, runJourneySteps]);

  const applyRepair = useCallback(() => { setJourneyRepaired(true); setSelectedStepId('create-order'); setJourneyMode('map'); setRequestError(''); }, []);
  const approveRepairAndRun = useCallback(() => {
    const repairedFlow = buildFlow('checkout', true);
    applyRepair();
    return runJourneySteps(repairedFlow.steps);
  }, [applyRepair, runJourneySteps]);
  const selectFlow = useCallback((id: FlowId) => { const flow = buildFlow(id, journeyRepaired); setActiveFlowId(id); setJourneyPositions(autoLayoutJourney(flow.steps)); setSelectedStepId(flow.steps[0].id); setJourneyResults([]); setJourneyMode('map'); setView('journeys'); }, [journeyRepaired]);
  const moveFlowNode = useCallback((id: string, x: number, y: number) => setJourneyPositions((current) => moveJourneyNode(current, id, x, y)), []);
  const autoLayoutFlow = useCallback(() => { setJourneyPositions(autoLayoutJourney(journeySteps)); setJourneyMode('map'); }, [journeySteps]);
  const runBurst = useCallback(async (override: { count?: number; concurrency?: number } = {}) => {
    if (isBurstRunning) return null;
    const count = Math.min(50, Math.max(1, override.count ?? burstCount));
    const concurrency = Math.min(10, Math.max(1, override.concurrency ?? burstConcurrency));
    setIsBurstRunning(true); setBurstResult(null); setView('runs');
    const durations: number[] = []; let errors = 0; let cursor = 0;
    const worker = async () => { while (cursor < count) { cursor += 1; try { const result = await executeRequest({ method: 'GET', url: '/api/demo?action=get_order&id=ord_burst', headers: defaultHeaders }); durations.push(result.durationMs); if (result.status >= 400) errors += 1; } catch { errors += 1; } } };
    await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
    const next = { count, successRate: Math.round(((count - errors) / count) * 100), p50: percentile(durations, .5), p95: percentile(durations, .95), errors };
    setBurstResult(next); setIsBurstRunning(false); return next;
  }, [burstConcurrency, burstCount, executeRequest, isBurstRunning]);

  const saveWorkspace = useCallback(async () => {
    if (variables.some(({ key }) => isSensitiveVariableKey(key))) { setSaveStatus('error'); setRequestError('Secret-like variables are not persisted. Remove them before saving.'); return; }
    setSaveStatus('saving');
    try {
      const safeCollections = importedCollections.map((collection) => ({ ...collection, requests: collection.requests.map((request) => ({ ...request, headers: withoutSensitiveHeaders(request.headers) })) }));
      const result = await fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeRequest: { method, url, body, headers: withoutSensitiveHeaders(headers), name: requestName, collection: collectionName }, environment: { name: environmentName, variables }, importedCollections: safeCollections, assertions: { expectedStatus, maxDurationMs }, journeyRepaired, activeFlowId, journeyPositions } satisfies SavedWorkspace) });
      if (result.status === 401) { window.location.assign('/signin-with-chatgpt?return_to=/'); return; }
      if (!result.ok) throw new Error('Save failed.'); setSaveStatus('saved'); window.setTimeout(() => setSaveStatus('idle'), 1600);
    } catch { setSaveStatus('error'); }
  }, [activeFlowId, body, collectionName, environmentName, expectedStatus, headers, importedCollections, journeyPositions, journeyRepaired, maxDurationMs, method, requestName, url, variables]);

  function openCollectionRequest(collection: ApiCollection, requestId: string) {
    const request = collection.requests.find((candidate) => candidate.id === requestId); if (!request) return;
    setCollectionName(collection.name); setRequestName(request.name); setMethod(request.method); setUrl(request.url); setHeaders(request.headers.length ? request.headers : defaultHeaders); setBody(request.body); setAuth({ type: 'none' });
    setExpectedStatus(request.method === 'POST' ? 201 : request.method === 'DELETE' ? 204 : 200); setResponse(null); setRequestError(''); setView('requests');
  }
  async function importCollection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try { const collection = importPostmanCollection(JSON.parse(await file.text())); setImportedCollections((current) => [...current, collection]); openCollectionRequest(collection, collection.requests[0].id); }
    catch (error) { setRequestError(error instanceof Error ? error.message : 'Collection could not be imported.'); }
  }
  function exportActiveCollection() {
    const collection: ApiCollection = { id: 'active', name: collectionName, requests: [{ id: 'active-request', name: requestName, method, url, headers, body }] };
    const downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(exportPostmanCollection(collection), null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = downloadUrl; anchor.download = `${collectionName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'collection'}.postman_collection.json`; anchor.click(); URL.revokeObjectURL(downloadUrl);
  }

  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void sendRequest(); } }; window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown); }, [sendRequest]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 860px)');
    const closePanels = (event: MediaQueryListEvent) => { if (event.matches) { setNavigatorOpen(false); setInspectorOpen(false); } };
    media.addEventListener('change', closePanels);
    return () => media.removeEventListener('change', closePanels);
  }, []);

  useEffect(() => {
    if (typeof document.modelContext?.registerTool !== 'function') return;
    const controller = new AbortController(); const emptySchema = { type: 'object', properties: {}, additionalProperties: false }; const rawRegister = document.modelContext.registerTool.bind(document.modelContext);
    const register = (tool: WebMcpTool, options?: { signal?: AbortSignal }) => rawRegister({ ...tool, execute: async (input) => {
      const id = crypto.randomUUID(); const startedAt = Date.now(); const title = tool.title ?? tool.name; const summary = summarizeAgentToolInput(tool.name, input); const approvalRequired = requiresAgentApproval(tool.name);
      const event: AgentToolEvent = { id, name: tool.name, title, input: summary, status: approvalRequired ? 'waiting' : 'running', startedAt };
      setAgentEvents((current) => [event, ...current].slice(0, 20));
      setAgentTraceOpen(true);
      let executionStartedAt = startedAt;
      if (approvalRequired) {
        const approved = await requestAgentApproval({ id, name: tool.name, title, input: summary });
        if (!approved) {
          setAgentEvents((current) => current.map((event) => event.id === id ? { ...event, status: 'denied', durationMs: Date.now() - startedAt } : event));
          throw new Error('Action denied by the user.');
        }
        executionStartedAt = Date.now();
        setAgentEvents((current) => current.map((event) => event.id === id ? { ...event, status: 'running' } : event));
      }
      try {
        const output = await tool.execute(input);
        const failed = agentToolOutputFailed(tool.name, output);
        setAgentEvents((current) => current.map((event) => event.id === id ? { ...event, status: failed ? 'failed' : 'passed', durationMs: Date.now() - executionStartedAt } : event));
        return output;
      } catch (error) {
        setAgentEvents((current) => current.map((event) => event.id === id ? { ...event, status: 'failed', durationMs: Date.now() - executionStartedAt } : event));
        throw error;
      }
    } }, options);
    void Promise.all([
      register({ name: 'get_active_request', title: 'Get active request', description: 'Read the request currently visible in Runwire. Authentication values stay protected.', inputSchema: emptySchema, annotations: { readOnlyHint: true }, execute: () => ({ method, url, resolvedUrl: render(url), headers: protectSensitiveHeaders(headers), body, expectedStatus, auth: { type: auth.type, configured: isRequestAuthConfigured(auth) } }) }, { signal: controller.signal }),
      register({ name: 'run_active_request', title: 'Run active request', description: 'Run the visible request and update its response panel.', inputSchema: emptySchema, execute: async () => ({ response: await sendRequest() }) }, { signal: controller.signal }),
      register({ name: 'update_active_request', title: 'Update active request', description: 'Update the visible request method, URL, or body. Changing the URL clears protected authentication and sensitive headers.', inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }, url: { type: 'string', maxLength: 2048 }, body: { type: 'string', maxLength: 256000 } }, additionalProperties: false }, execute: (input) => { if (typeof input.method === 'string') setMethod(input.method); if (typeof input.url === 'string') { setUrl(input.url); setAuth({ type: 'none' }); setHeaders((current) => withoutSensitiveHeaders(current)); } if (typeof input.body === 'string') setBody(input.body); setView('requests'); return { updated: Object.keys(input), protectedCredentialsCleared: typeof input.url === 'string' }; } }, { signal: controller.signal }),
      register({ name: 'get_last_response', title: 'Get last response', description: 'Inspect the latest visible API response or error.', inputSchema: emptySchema, annotations: { readOnlyHint: true }, execute: () => response ? { ...response, body: response.body.slice(0, 100000) } : { available: false, error: requestError || undefined } }, { signal: controller.signal }),
      register({ name: 'get_journey', title: 'Get journey', description: 'Read the active ordered journey, visual workflow, extractions, assertions, and latest results.', inputSchema: emptySchema, annotations: { readOnlyHint: true }, execute: () => ({ id: activeFlow.id, name: activeFlow.name, collection: activeFlow.collection, steps: journeySteps, edges: journeyEdges, positions: journeyPositions, results: journeyResults, repaired: journeyRepaired }) }, { signal: controller.signal }),
      register({ name: 'get_flow_map', title: 'Get workflow map', description: 'Read the visible executable workflow graph, node positions, data bindings, selection, and run state.', inputSchema: emptySchema, annotations: { readOnlyHint: true }, execute: () => ({ flowId: activeFlow.id, nodes: journeySteps.map((step) => ({ ...step, position: journeyPositions.find((position) => position.id === step.id) })), edges: journeyEdges, selectedStepId, results: journeyResults }) }, { signal: controller.signal }),
      register({ name: 'select_flow', title: 'Select API flow', description: 'Open one of the available executable API flows.', inputSchema: { type: 'object', properties: { flowId: { type: 'string', enum: ['checkout', 'tickets'] } }, required: ['flowId'], additionalProperties: false }, execute: (input) => { if (input.flowId !== 'checkout' && input.flowId !== 'tickets') throw new Error('flowId is required.'); selectFlow(input.flowId); return { selected: input.flowId, name: buildFlow(input.flowId, journeyRepaired).name }; } }, { signal: controller.signal }),
      register({ name: 'select_journey_step', title: 'Select journey step', description: 'Open a journey node in the visible workflow inspector.', inputSchema: { type: 'object', properties: { stepId: { type: 'string', enum: journeySteps.map((step) => step.id) } }, required: ['stepId'], additionalProperties: false }, execute: (input) => { if (typeof input.stepId !== 'string') throw new Error('stepId is required.'); setSelectedStepId(input.stepId); setJourneyMode('map'); setView('journeys'); return { selected: input.stepId }; } }, { signal: controller.signal }),
      register({ name: 'move_flow_node', title: 'Move workflow node', description: 'Move one visible workflow node without changing execution behavior.', inputSchema: { type: 'object', properties: { stepId: { type: 'string', enum: journeySteps.map((step) => step.id) }, x: { type: 'number', minimum: 24, maximum: 1800 }, y: { type: 'number', minimum: 96, maximum: 720 } }, required: ['stepId', 'x', 'y'], additionalProperties: false }, execute: (input) => { if (typeof input.stepId !== 'string' || typeof input.x !== 'number' || typeof input.y !== 'number') throw new Error('stepId, x, and y are required.'); moveFlowNode(input.stepId, input.x, input.y); setJourneyMode('map'); setView('journeys'); return { moved: input.stepId, x: input.x, y: input.y }; } }, { signal: controller.signal }),
      register({ name: 'auto_layout_flow', title: 'Arrange workflow', description: 'Arrange the visible executable workflow from left to right while preserving every request and binding.', inputSchema: emptySchema, execute: () => { autoLayoutFlow(); setView('journeys'); return { arranged: true, nodes: journeySteps.length }; } }, { signal: controller.signal }),
      register({ name: 'run_journey', title: 'Run journey', description: 'Run every journey step in order, pass extracted values forward, and stop on failure.', inputSchema: emptySchema, execute: async () => ({ results: await runJourney() }) }, { signal: controller.signal }),
      register({ name: 'apply_idempotency_repair', title: 'Apply idempotency repair', description: 'Add the missing generated Idempotency-Key header to Create order in Checkout recovery.', inputSchema: emptySchema, execute: () => { if (activeFlow.id !== 'checkout') throw new Error('This repair only applies to Checkout recovery.'); applyRepair(); return { updated: true, stepId: 'create-order', header: 'Idempotency-Key' }; } }, { signal: controller.signal }),
      register({ name: 'run_controlled_burst', title: 'Run controlled GET burst', description: 'Run 1–50 safe GET requests with bounded concurrency and show success rate, p50, p95, and errors.', inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 50 }, concurrency: { type: 'integer', minimum: 1, maximum: 10 } }, additionalProperties: false }, execute: async (input) => { const count = typeof input.count === 'number' ? input.count : burstCount; const concurrency = typeof input.concurrency === 'number' ? input.concurrency : burstConcurrency; setBurstCount(count); setBurstConcurrency(concurrency); return { result: await runBurst({ count, concurrency }) }; } }, { signal: controller.signal }),
      register({ name: 'get_run_history', title: 'Get run history', description: 'Read recent journey run outcomes and burst metrics.', inputSchema: emptySchema, annotations: { readOnlyHint: true }, execute: () => ({ runs, burst: burstResult }) }, { signal: controller.signal }),
      register({ name: 'set_environment_variable', title: 'Set non-sensitive variable', description: 'Set a non-sensitive environment value visible to the user.', inputSchema: { type: 'object', properties: { key: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]*$', maxLength: 80 }, value: { type: 'string', maxLength: 4096 } }, required: ['key', 'value'], additionalProperties: false }, execute: (input) => { if (typeof input.key !== 'string' || typeof input.value !== 'string') throw new Error('key and value are required.'); if (isSensitiveVariableKey(input.key)) throw new Error('Sensitive variables require the protected human flow.'); setVariables((current) => current.some((item) => item.key === input.key) ? current.map((item) => item.key === input.key ? { key: input.key as string, value: input.value as string } : item) : [...current, { key: input.key, value: input.value } as EnvironmentVariable]); setEnvironmentOpen(true); return { updated: input.key }; } }, { signal: controller.signal }),
    ]).then(() => setWebMcpReady(true)).catch(() => setWebMcpReady(false));
    return () => controller.abort();
  }, [activeFlow, applyRepair, auth, autoLayoutFlow, body, burstConcurrency, burstCount, burstResult, expectedStatus, headers, journeyEdges, journeyPositions, journeyRepaired, journeyResults, journeySteps, method, moveFlowNode, render, requestAgentApproval, requestError, response, runBurst, runJourney, runs, selectFlow, selectedStepId, sendRequest, url]);

  const failedJourneyResult = journeyResults.find((result) => result.status === 'failed');
  const selectedResult = journeyResults.find((result) => result.id === selectedStep.id);
  const passedCount = journeyResults.filter((result) => result.status === 'passed').length;
  const repairSessionOpen = view === 'journeys' && activeFlow.id === 'checkout' && selectedStep.id === 'create-order' && failedJourneyResult?.id === 'create-order' && !journeyRepaired;
  const selectWorkspaceView = (nextView: View) => {
    setNavigatorOpen((open) => nextView === view ? !open : true);
    setView(nextView);
  };

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark" aria-hidden="true" /><span>Runwire</span><span className="workspace-pill">API workspace</span></div><AgentTrace events={agentEvents} open={agentTraceOpen} ready={webMcpReady} pending={pendingAgentApproval} flow={activeFlow} edges={journeyEdges} results={journeyResults} isJourneyRunning={isJourneyRunning} onApprove={() => respondToAgentApproval(true)} onDeny={() => respondToAgentApproval(false)} onSelectStep={(stepId) => { setSelectedStepId(stepId); setJourneyMode('map'); setView('journeys'); }} onToggle={() => setAgentTraceOpen((open) => !open)} /><div className="topbar-actions"><button className="button ghost env-button" type="button" onClick={() => setEnvironmentOpen((open) => !open)}><span className="presence-dot" />{environmentName}<CaretDown size={14} /></button><button className="icon-button" type="button" aria-label={workspaceMode === 'cloud' ? 'Save workspace' : 'Sign in to save workspace'} title={workspaceMode === 'cloud' ? 'Save workspace' : 'Sign in to save workspace'} onClick={saveWorkspace} disabled={!workspaceReady || saveStatus === 'saving'}><FloppyDisk size={18} /></button><span className="avatar" title={workspaceMode === 'cloud' ? 'Cloud workspace' : 'Guest session'}>{userInitials}</span><button className="topbar-more" type="button" aria-label="Open environment settings" onClick={() => setEnvironmentOpen(true)}><DotsThreeVertical size={18} weight="bold" /></button></div></header>
    {environmentOpen && <EnvironmentPanel name={environmentName} setName={setEnvironmentName} variables={variables} setVariables={setVariables} onClose={() => setEnvironmentOpen(false)} />}
    <div className={`workspace-layout${navigatorOpen ? '' : ' navigator-closed'}${inspectorOpen ? '' : ' inspector-closed'}${view === 'journeys' ? ' journey-layout' : ''}${repairSessionOpen ? ' repair-session-open' : ''}`}>
      <nav className="icon-rail" aria-label="Workspace sections"><div className="rail-main"><RailButton label="Requests" active={view === 'requests'} onClick={() => selectWorkspaceView('requests')}><TerminalWindow size={20} /></RailButton><RailButton label="Flows" active={view === 'journeys'} onClick={() => selectWorkspaceView('journeys')}><BracketsCurly size={20} /></RailButton><RailButton label="Runs" active={view === 'runs'} onClick={() => selectWorkspaceView('runs')}><Pulse size={20} /></RailButton></div><RailButton label="Environment" onClick={() => setEnvironmentOpen(true)}><GearSix size={20} /></RailButton></nav>
      <Navigator view={view} filterQuery={filterQuery} setFilterQuery={setFilterQuery} visibleCollections={visibleCollections} requestName={requestName} collectionName={collectionName} openCollectionRequest={openCollectionRequest} importInput={importInput} importCollection={importCollection} exportActiveCollection={exportActiveCollection} onClose={() => setNavigatorOpen(false)} activeFlowId={activeFlowId} onSelectFlow={selectFlow} runs={runs} selectedRun={selectedRun} setSelectedRunId={setSelectedRunId} />
      <section className="main-canvas">
        {view === 'requests' && <RequestWorkspace method={method} setMethod={setMethod} url={url} setUrl={setUrl} body={body} setBody={setBody} headers={headers} setHeaders={setHeaders} auth={auth} setAuth={setAuth} requestName={requestName} setRequestName={setRequestName} collectionName={collectionName} activeTab={activeEditorTab} setActiveTab={setActiveEditorTab} expectedStatus={expectedStatus} setExpectedStatus={setExpectedStatus} maxDurationMs={maxDurationMs} setMaxDurationMs={setMaxDurationMs} response={response} responseTab={responseTab} setResponseTab={setResponseTab} formattedBody={formattedBody} requestError={requestError} assertionResults={assertionResults} isSending={isSending} workspaceReady={workspaceReady} workspaceMode={workspaceMode} onSend={sendRequest} saveStatus={saveStatus} onOpenAgentTrace={() => setAgentTraceOpen(true)} onOpenInspector={() => setInspectorOpen(true)} />}
        {view === 'journeys' && <JourneyBuilder flow={activeFlow} edges={journeyEdges} positions={journeyPositions} results={journeyResults} selectedStepId={selectedStep.id} setSelectedStepId={setSelectedStepId} moveNode={moveFlowNode} mode={journeyMode} setMode={setJourneyMode} autoLayout={autoLayoutFlow} isRunning={isJourneyRunning} passedCount={passedCount} onRun={runJourney} repaired={journeyRepaired} inspectorOpen={inspectorOpen} onInspectFailure={() => { if (failedJourneyResult) setSelectedStepId(failedJourneyResult.id); setInspectorOpen(true); }} />}
        {view === 'runs' && <RunResults run={selectedRun} burstCount={burstCount} setBurstCount={setBurstCount} burstConcurrency={burstConcurrency} setBurstConcurrency={setBurstConcurrency} burstResult={burstResult} isBurstRunning={isBurstRunning} onBurst={() => runBurst()} onOpenJourney={() => setView('journeys')} />}
      </section>
      <aside className="inspector"><div className="panel-title-row"><div><p className="eyebrow">{repairSessionOpen ? 'WebMCP collaboration' : 'Inspector'}</p><h2>{view === 'requests' ? 'Environment' : repairSessionOpen ? 'Repair session' : view === 'journeys' ? 'Node details' : 'Run details'}</h2></div><div className="panel-title-actions">{repairSessionOpen && <span className="repair-waiting">Waiting for approval</span>}<button className="icon-button compact" type="button" aria-label="Collapse inspector" onClick={() => setInspectorOpen(false)}><X size={16} /></button></div></div>{view === 'requests' && <RequestInspector variables={variables} response={response} />}{view === 'journeys' && (repairSessionOpen ? <RepairSession step={selectedStep} result={selectedResult} isRunning={isJourneyRunning} onReject={() => setInspectorOpen(false)} onApproveAndRun={approveRepairAndRun} /> : <StepInspector step={selectedStep} result={selectedResult} failed={failedJourneyResult?.id === selectedStep.id} repaired={journeyRepaired} onRepair={applyRepair} />)}{view === 'runs' && <RunInspector run={selectedRun} burst={burstResult} />}</aside>
      {!inspectorOpen && view !== 'requests' && <button className="edge-toggle right" type="button" aria-label="Open inspector" onClick={() => setInspectorOpen(true)}><SlidersHorizontal size={16} /></button>}
    </div>
  </main>;
}

function RailButton({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) { return <button className={`rail-button${active ? ' active' : ''}`} type="button" onClick={onClick} aria-label={label} aria-current={active ? 'page' : undefined}>{children}<span>{label}</span></button>; }

function AgentTrace({ events, open, ready, pending, flow, edges, results, isJourneyRunning, onApprove, onDeny, onSelectStep, onToggle }: { events: AgentToolEvent[]; open: boolean; ready: boolean; pending: PendingAgentApproval | null; flow: FlowDefinition; edges: JourneyFlowEdge[]; results: JourneyStepResult[]; isJourneyRunning: boolean; onApprove: () => void; onDeny: () => void; onSelectStep: (stepId: string) => void; onToggle: () => void }) {
  const [mode, setMode] = useState<'calls' | 'flow'>('calls');
  const latest = events[0];
  const journeyEvent = events.find((event) => event.name === 'run_journey');
  const compactOpen = open && !pending && mode === 'calls' && events.length > 0 && events.length <= 2;
  const statusIcon = (event: AgentToolEvent) => event.status === 'waiting' ? <WarningCircle size={14} weight="fill" /> : event.status === 'running' ? <ArrowsClockwise className="spin" size={14} /> : event.status === 'passed' ? <CheckCircle size={14} weight="fill" /> : <XCircle size={14} weight="fill" />;
  const statusCopy = (event: AgentToolEvent) => event.status === 'waiting' ? 'Approval required' : event.status === 'running' ? 'Running' : event.status === 'denied' ? 'Denied' : event.status === 'failed' ? `Failed · ${event.durationMs ?? 0} ms` : `${event.durationMs ?? 0} ms`;
  return <section className={`agent-trace${open || pending ? ' open' : ''}${compactOpen ? ' compact-open' : ''}${pending ? ' approval-open' : ''}`} style={compactOpen ? { flexBasis: 78 + events.length * 36 } : undefined} aria-label="WebMCP tool calls">
    <button className="agent-trace-bar" type="button" onClick={() => { if (!pending) onToggle(); }} aria-expanded={open || Boolean(pending)}>
      <span className="agent-trace-label"><Robot size={15} />Agent trace</span>
      <span className={`agent-trace-latest ${latest?.status ?? (ready ? 'ready' : 'unavailable')}`} aria-live="polite">{latest ? <>{statusIcon(latest)}<strong>{latest.title}</strong><code>{latest.name}</code><span>{statusCopy(latest)}</span></> : <><span className={ready ? 'presence-dot' : 'agent-trace-offline'} /><strong>{ready ? 'WebMCP ready' : 'WebMCP unavailable'}</strong><span>{ready ? 'Tool calls will appear here' : 'Open in a supported browser'}</span></>}</span>
      <span className="agent-trace-count">{events.length ? `${events.length} call${events.length === 1 ? '' : 's'}` : ready ? '15 tools' : 'Not connected'}</span><CaretDown className="agent-trace-caret" size={14} />
    </button>
    <div className="agent-trace-history">
      {pending && <div className="agent-approval" role="alert"><WarningCircle size={18} weight="fill" /><span><strong>Approval required</strong><span>{pending.title} · {pending.input}</span></span><div><button className="button ghost" type="button" onClick={onDeny}>Deny</button><button className="button primary" type="button" onClick={onApprove}><Play size={14} weight="fill" />Approve &amp; run</button></div></div>}
      <div className="agent-trace-tabs"><div className="segmented" role="group" aria-label="Agent trace view"><button className={mode === 'calls' ? 'active' : ''} type="button" onClick={() => setMode('calls')}>Tool calls</button><button className={mode === 'flow' ? 'active' : ''} type="button" onClick={() => setMode('flow')}>API flow</button></div><span>{mode === 'calls' ? 'Safe WebMCP history' : `${flow.steps.length} executable requests`}</span></div>
      {mode === 'calls' ? <div className="agent-trace-calls">{events.length ? events.filter((event) => event.id !== pending?.id).map((event) => <div className={`agent-trace-row ${event.status}`} key={event.id}>{statusIcon(event)}<span><strong>{event.title}</strong><code>{event.name}</code></span><span className="agent-trace-input">{event.input}</span><span className="agent-trace-duration">{statusCopy(event)}</span></div>) : !pending && <div className="agent-trace-empty"><Robot size={18} /><span><strong>Waiting for the agent</strong>Run a WebMCP tool and its safe execution evidence will appear here.</span></div>}</div> : <div className="agent-execution-flow" aria-label={`${flow.name} WebMCP execution path`}>
        <div className={`agent-flow-tool ${journeyEvent?.status ?? 'ready'}`}><Robot size={16} /><span><small>WebMCP tool</small><strong>run_journey</strong></span>{journeyEvent ? statusIcon(journeyEvent) : <span className="agent-flow-ready">Ready</span>}</div>
        {flow.steps.map((step, index) => {
          const result = results.find((candidate) => candidate.id === step.id);
          const running = isJourneyRunning && index === results.length;
          const edge = index === 0 ? null : edges.find((candidate) => candidate.to === step.id);
          return <div className="agent-flow-segment" key={step.id}><span className={`agent-flow-link${running ? ' running' : ''}`}><small>{index === 0 ? 'invokes' : edge?.label || 'then'}</small><span /></span><button className={`agent-flow-api${result ? ` ${result.status}` : ''}${running ? ' running' : ''}`} type="button" onClick={() => onSelectStep(step.id)}><span><span className={methodClass(step.method)}>{step.method}</span><small>{result ? `${result.actualStatus} · ${result.durationMs} ms` : running ? 'Calling…' : `Expect ${step.expectedStatus}`}</small></span><strong>{step.label}</strong><code>{result?.requestUrl ?? step.url}</code></button></div>;
        })}
      </div>}
    </div>
  </section>;
}

function Navigator({ view, filterQuery, setFilterQuery, visibleCollections, requestName, collectionName, openCollectionRequest, importInput, importCollection, exportActiveCollection, onClose, activeFlowId, onSelectFlow, runs, selectedRun, setSelectedRunId }: { view: View; filterQuery: string; setFilterQuery: (value: string) => void; visibleCollections: ApiCollection[]; requestName: string; collectionName: string; openCollectionRequest: (collection: ApiCollection, id: string) => void; importInput: React.RefObject<HTMLInputElement | null>; importCollection: (event: ChangeEvent<HTMLInputElement>) => void; exportActiveCollection: () => void; onClose: () => void; activeFlowId: FlowId; onSelectFlow: (id: FlowId) => void; runs: RunRecord[]; selectedRun: RunRecord | null; setSelectedRunId: (id: string) => void }) {
  return <aside className="navigator"><div className="panel-title-row"><div><p className="eyebrow">Workspace</p><h2>{view === 'requests' ? 'Collections' : view === 'journeys' ? 'Flows' : 'Run history'}</h2></div>{view === 'requests' ? <div className="navigator-title-actions"><button className="icon-button compact" type="button" aria-label="Import collection" onClick={() => importInput.current?.click()}><Plus size={17} /></button><button className="icon-button compact" type="button" aria-label="Export active collection" onClick={exportActiveCollection}><DotsThreeVertical size={17} weight="bold" /></button></div> : <button className="icon-button compact" type="button" aria-label="Collapse navigator" onClick={onClose}><List size={17} /></button>}</div>
    {view === 'requests' && <><label className="search"><MagnifyingGlass size={15} /><input value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} placeholder="Filter requests" /><kbd>⌘K</kbd></label><div className="navigator-scroll">{visibleCollections.map((collection) => <section className="collection" key={collection.id}><h3>{collection.name}<span>{collection.requests.length}</span></h3>{collection.requests.map((request) => { const active = request.name === requestName && collection.name === collectionName; return <button className={`request-item${active ? ' active' : ''}`} type="button" key={request.id} onClick={() => openCollectionRequest(collection, request.id)}><span className={methodClass(request.method)}>{request.method}</span><span>{request.name}</span>{active && <Circle className="request-active-dot" size={7} weight="fill" />}</button>; })}</section>)}</div><input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={importCollection} /><div className="navigator-actions"><button className="button ghost" type="button" onClick={() => importInput.current?.click()}><DownloadSimple size={15} />Import</button><button className="button ghost" type="button" onClick={exportActiveCollection}><CloudArrowUp size={15} />Export</button></div></>}
    {view === 'journeys' && <div className="navigator-scroll journey-list">{(['checkout', 'tickets'] as FlowId[]).map((id) => { const flow = buildFlow(id, false); return <button className={`journey-list-item${activeFlowId === id ? ' active' : ''}`} type="button" key={id} onClick={() => onSelectFlow(id)}><span className="journey-icon"><Lightning size={16} /></span><span><strong>{flow.name}</strong><small>{flow.steps.length} executable nodes</small></span></button>; })}</div>}
    {view === 'runs' && <div className="navigator-scroll run-list">{runs.length === 0 && <div className="empty-state compact-empty"><Clock size={22} /><strong>No flow runs yet</strong><span>Run either API flow to create history.</span></div>}{runs.map((run, index) => <button className={`run-list-item${selectedRun?.id === run.id ? ' active' : ''}`} type="button" key={run.id} onClick={() => setSelectedRunId(run.id)}>{run.status === 'passed' ? <CheckCircle size={17} weight="fill" /> : <XCircle size={17} weight="fill" />}<span><strong>{run.flowName}</strong><small>Run #{runs.length - index} · {run.durationMs} ms</small></span></button>)}</div>}
  </aside>;
}

function EnvironmentPanel({ name, setName, variables, setVariables, onClose }: { name: string; setName: (value: string) => void; variables: EnvironmentVariable[]; setVariables: React.Dispatch<React.SetStateAction<EnvironmentVariable[]>>; onClose: () => void }) {
  return <section className="environment-popover" aria-label="Environment variables"><div className="panel-title-row"><div><p className="eyebrow">Active environment</p><input className="popover-title-input" value={name} onChange={(event) => setName(event.target.value)} aria-label="Environment name" /></div><button className="icon-button compact" type="button" aria-label="Close environment" onClick={onClose}><X size={16} /></button></div><p className="security-note">Keep secrets out of saved variables. Use this workspace for non-sensitive test values.</p><div className="variable-head"><span>Variable</span><span>Value</span><span /></div><div className="variable-list">{variables.map((variable, index) => <div className="variable-row" key={`${variable.key}-${index}`}><input value={variable.key} onChange={(event) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} aria-label={`Variable ${index + 1} name`} /><input value={variable.value} onChange={(event) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} aria-label={`Variable ${index + 1} value`} /><button className="icon-button compact danger" type="button" onClick={() => setVariables((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${variable.key}`}><Trash size={14} /></button></div>)}</div><button className="text-button" type="button" onClick={() => setVariables((current) => [...current, { key: '', value: '' }])}><Plus size={14} />Add variable</button></section>;
}

type RequestWorkspaceProps = {
  method: string; setMethod: (value: string) => void; url: string; setUrl: (value: string) => void; body: string; setBody: (value: string) => void;
  headers: [string, string][]; setHeaders: React.Dispatch<React.SetStateAction<[string, string][]>>; auth: RequestAuth; setAuth: React.Dispatch<React.SetStateAction<RequestAuth>>; requestName: string; setRequestName: (value: string) => void;
  collectionName: string; activeTab: EditorTab; setActiveTab: (tab: EditorTab) => void; expectedStatus: number; setExpectedStatus: (value: number) => void;
  maxDurationMs: number; setMaxDurationMs: (value: number) => void; response: ApiResponse | null; responseTab: 'Body' | 'Headers'; setResponseTab: (tab: 'Body' | 'Headers') => void;
  formattedBody: string; requestError: string; assertionResults: { label: string; passed: boolean }[]; isSending: boolean; workspaceReady: boolean; workspaceMode: 'guest' | 'cloud'; onSend: (event?: FormEvent) => Promise<ApiResponse | null>; saveStatus: string; onOpenAgentTrace: () => void; onOpenInspector: () => void;
};
function RequestWorkspace(props: RequestWorkspaceProps) {
  const tabs: EditorTab[] = ['Params', 'Auth', 'Headers', 'Body', 'Tests'];
  return <div className="request-screen">
    <div className="screen-heading"><div><p className="breadcrumb">{props.collectionName} / Request</p><input className="title-input" value={props.requestName} onChange={(event) => props.setRequestName(event.target.value)} aria-label="Request name" /></div><div className="heading-meta"><button className="agent-tools-button" type="button" onClick={props.onOpenAgentTrace}><Robot size={14} />Agent tools<CaretDown size={13} /></button><button className="icon-button" type="button" aria-label="Open request inspector" onClick={props.onOpenInspector}><Code size={18} /></button></div></div>
    <form className="request-composer" onSubmit={props.onSend}><select className={methodClass(props.method)} value={props.method} onChange={(event) => props.setMethod(event.target.value)} aria-label="HTTP method"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select><input className="url-input" value={props.url} onChange={(event) => props.setUrl(event.target.value)} aria-label="Request URL" spellCheck={false} /><button className="button primary send" type="submit" disabled={!props.workspaceReady || props.isSending}><span className="send-label">{props.isSending ? <ArrowsClockwise className="spin" size={18} /> : <Play size={17} weight="fill" />}{props.isSending ? 'Sending' : 'Send'}</span><span className="send-caret"><CaretDown size={14} /></span></button></form>
    <p className="shortcut">⌘ Enter to send · {props.saveStatus === 'saved' ? 'workspace saved' : props.workspaceMode === 'cloud' ? 'cloud draft' : 'guest session · sign in to save'}</p>
    <div className="request-main-grid"><section className="request-editor-pane"><div className="tab-row" role="tablist">{tabs.map((tab) => <button className={props.activeTab === tab ? 'active' : ''} type="button" role="tab" aria-selected={props.activeTab === tab} onClick={() => props.setActiveTab(tab)} key={tab}>{tab}{tab === 'Headers' && <span>{props.headers.length}</span>}{tab === 'Auth' && props.auth.type !== 'none' && <span>1</span>}</button>)}</div>
      <div className="editor-card">
        {props.activeTab === 'Headers' && <div className="key-value-table"><div className="table-head"><span>Header</span><span>Value</span><span /></div>{props.headers.map(([key, value], index) => <div className="table-row" key={`${key}-${index}`}><input value={key} onChange={(event) => props.setHeaders((current) => current.map((item, itemIndex) => itemIndex === index ? [event.target.value, item[1]] : item))} aria-label={`Header ${index + 1} name`} /><input value={value} onChange={(event) => props.setHeaders((current) => current.map((item, itemIndex) => itemIndex === index ? [item[0], event.target.value] : item))} aria-label={`Header ${index + 1} value`} /><button className="icon-button compact danger" type="button" aria-label={`Remove ${key}`} onClick={() => props.setHeaders((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash size={14} /></button></div>)}<button className="text-button table-add" type="button" onClick={() => props.setHeaders((current) => [...current, ['', '']])}><Plus size={14} />Add header</button></div>}
        {props.activeTab === 'Auth' && <AuthEditor auth={props.auth} setAuth={props.setAuth} />}
        {props.activeTab === 'Body' && <textarea className="code-editor" value={props.body} onChange={(event) => props.setBody(event.target.value)} aria-label="Request body" placeholder="No request body" spellCheck={false} />}
        {props.activeTab === 'Params' && <div className="empty-state mini"><SlidersHorizontal size={22} /><strong>Query parameters live in the URL</strong><span>Use ?key=value and variables like {'{{orderId}}'}.</span></div>}
        {props.activeTab === 'Tests' && <div className="test-fields"><label>Expected status<input type="number" min="100" max="599" value={props.expectedStatus} onChange={(event) => props.setExpectedStatus(Number(event.target.value))} /></label><label>Maximum duration<span className="input-suffix"><input type="number" min="1" max="60000" value={props.maxDurationMs} onChange={(event) => props.setMaxDurationMs(Number(event.target.value))} /><span>ms</span></span></label></div>}
      </div></section>
      <ResponsePanel response={props.response} responseTab={props.responseTab} setResponseTab={props.setResponseTab} formattedBody={props.formattedBody} requestError={props.requestError} assertions={props.assertionResults} />
    </div>
  </div>;
}

function AuthEditor({ auth, setAuth }: { auth: RequestAuth; setAuth: React.Dispatch<React.SetStateAction<RequestAuth>> }) {
  const setType = (type: RequestAuth['type']) => setAuth(type === 'bearer' ? { type, token: '' } : type === 'api-key' ? { type, key: 'X-API-Key', value: '', location: 'header' } : type === 'basic' ? { type, username: '', password: '' } : { type: 'none' });
  return <div className="auth-editor"><label className="auth-type">Authentication<select value={auth.type} onChange={(event) => setType(event.target.value as RequestAuth['type'])}><option value="none">No auth</option><option value="bearer">Bearer token</option><option value="api-key">API key</option><option value="basic">Basic auth</option></select></label>{auth.type === 'bearer' && <label>Token<input type="password" value={auth.token} onChange={(event) => setAuth({ ...auth, token: event.target.value })} placeholder="Enter token" autoComplete="off" /></label>}{auth.type === 'basic' && <div className="auth-grid"><label>Username<input value={auth.username} onChange={(event) => setAuth({ ...auth, username: event.target.value })} autoComplete="off" /></label><label>Password<input type="password" value={auth.password} onChange={(event) => setAuth({ ...auth, password: event.target.value })} autoComplete="off" /></label></div>}{auth.type === 'api-key' && <div className="auth-grid api-key-grid"><label>Key<input value={auth.key} onChange={(event) => setAuth({ ...auth, key: event.target.value })} /></label><label>Value<input type="password" value={auth.value} onChange={(event) => setAuth({ ...auth, value: event.target.value })} autoComplete="off" /></label><label>Send in<select value={auth.location} onChange={(event) => setAuth({ ...auth, location: event.target.value as 'header' | 'query' })}><option value="header">Header</option><option value="query">Query string</option></select></label></div>}<p className="auth-note"><WarningCircle size={15} />Credentials stay in this browser tab, are excluded from workspace saves, and are never exposed to the agent.</p></div>;
}

function ResponsePanel({ response, responseTab, setResponseTab, formattedBody, requestError, assertions }: { response: ApiResponse | null; responseTab: 'Body' | 'Headers'; setResponseTab: (tab: 'Body' | 'Headers') => void; formattedBody: string; requestError: string; assertions: { label: string; passed: boolean }[] }) {
  const content = requestError || (responseTab === 'Headers' && response ? response.headers.map(([key, value]) => `${key}: ${value}`).join('\n') : formattedBody);
  const empty = !response && !requestError;
  const copyResponse = () => { if (content) void navigator.clipboard.writeText(content); };
  return <section className="response-card"><div className="response-header"><button className="response-title" type="button" onClick={() => response && setResponseTab(responseTab === 'Body' ? 'Headers' : 'Body')}><h2>Response</h2><CaretDown size={13} />{response && <span className={`status-chip ${response.status >= 400 ? 'failed' : 'passed'}`}>{response.status} {response.statusText}</span>}{requestError && <span className="status-chip failed">Request failed</span>}</button><div className="response-actions"><button type="button" aria-label="Copy response" onClick={copyResponse} disabled={!content}><Copy size={17} /></button><button type="button" aria-label="Search response" disabled={!content}><MagnifyingGlass size={17} /></button><button type="button" aria-label="Toggle response headers" onClick={() => response && setResponseTab(responseTab === 'Body' ? 'Headers' : 'Body')} disabled={!response}><Code size={18} /></button></div></div>{empty ? <div className="response-empty"><img src="/runwire-empty-response-v2.png" width="122" height="96" alt="" /><strong>No response yet</strong><p>Send a request to inspect the response body,<br />headers, timing, and assertions.</p></div> : <pre className={`response-body${requestError ? ' error' : ''}`}><code>{content}</code></pre>}<div className="response-footer">{assertions.length > 0 && <div className="assertion-row">{assertions.map((assertion) => <span className={assertion.passed ? 'passed' : 'failed'} key={assertion.label}>{assertion.passed ? <Check size={13} /> : <X size={13} />}{assertion.label}</span>)}</div>}<div className="response-meta"><span>Status <strong>{response?.status ?? '—'}</strong></span><span>Time <strong>{response ? `${response.durationMs} ms` : '—'}</strong></span><span>Size <strong>{response ? `${response.sizeBytes} B` : '—'}</strong></span></div></div></section>;
}

function JourneyBuilder({ flow, edges, positions, results, selectedStepId, setSelectedStepId, moveNode, mode, setMode, autoLayout, isRunning, passedCount, onRun, repaired, inspectorOpen, onInspectFailure }: { flow: FlowDefinition; edges: JourneyFlowEdge[]; positions: JourneyNodePosition[]; results: JourneyStepResult[]; selectedStepId: string; setSelectedStepId: (id: string) => void; moveNode: (id: string, x: number, y: number) => void; mode: JourneyMode; setMode: (mode: JourneyMode) => void; autoLayout: () => void; isRunning: boolean; passedCount: number; onRun: () => Promise<JourneyStepResult[]>; repaired: boolean; inspectorOpen: boolean; onInspectFailure: () => void }) {
  const steps = flow.steps;
  const extractionCount = steps.reduce((total, step) => total + (step.extracts?.length ?? 0), 0);
  const failed = results.find((result) => result.status === 'failed');
  const failedStep = steps.find((step) => step.id === failed?.id);
  const failureCode = failed?.responseBody?.includes('MISSING_IDEMPOTENCY_KEY') ? 'MISSING_IDEMPOTENCY_KEY' : failed?.error || (failed ? `HTTP ${failed.actualStatus}` : '');
  const completed = results.length === steps.length && !failed;
  const stateLabel = failed ? 'Needs repair' : isRunning ? 'Running' : completed ? 'Passed' : results.length ? 'Partial run' : 'Ready';
  const showFailureEvidence = mode === 'map' && Boolean(failed && failedStep);
  return <div className="journey-screen flow-screen">
    <header className="flow-command-bar"><div className="flow-title-block"><p className="breadcrumb">Flows / {flow.collection}</p><div className="flow-title-line"><h1>{flow.name}</h1><span className={`flow-state${failed ? ' failed' : isRunning ? ' running' : completed ? ' passed' : ''}`}><span />{stateLabel}</span></div><p className="screen-subtitle">{flow.description}</p><div className="flow-meta-line"><span><strong>{steps.length}</strong> requests</span><span><strong>{extractionCount}</strong> bindings</span><span><strong>{results.length ? `${passedCount}/${steps.length}` : '—'}</strong> last run</span></div></div><button className="button primary flow-run-button" type="button" onClick={onRun} disabled={isRunning}>{isRunning ? <ArrowsClockwise className="spin" size={17} /> : <Play size={16} weight="fill" />}{isRunning ? 'Running flow' : 'Run flow'}</button></header>
    <section className={`flow-workbench${showFailureEvidence ? ' has-failure-evidence' : ''}`} aria-label="API flow workbench">
      <div className="flow-toolbar"><div className="segmented" role="group" aria-label="Workflow view"><button className={mode === 'map' ? 'active' : ''} type="button" onClick={() => setMode('map')}>Canvas</button><button className={mode === 'list' ? 'active' : ''} type="button" onClick={() => setMode('list')}>Evidence</button></div><span className="flow-toolbar-context"><span className="presence-dot" />Agent-synced workspace</span><button className="button ghost" type="button" onClick={autoLayout}><ArrowsClockwise size={15} />Arrange</button></div>
      {mode === 'map'
        ? <><FlowCanvas steps={steps} edges={edges} positions={positions} results={results} selectedStepId={selectedStepId} setSelectedStepId={setSelectedStepId} moveNode={moveNode} isRunning={isRunning} />{failed && failedStep && <FailureEvidence step={failedStep} result={failed} />}</>
        : <FlowList key={flow.id} steps={steps} results={results} selectedStepId={selectedStepId} setSelectedStepId={setSelectedStepId} isRunning={isRunning} />}
      <div className={`journey-footer${failed ? ' failed' : isRunning ? ' running' : completed ? ' passed' : ''}`}><span>{failed ? <WarningCircle size={18} weight="fill" /> : isRunning ? <ArrowsClockwise className="spin" size={17} /> : completed ? <CheckCircle size={18} weight="fill" /> : <Pulse size={17} />}<span><strong>{failed ? `${failedStep?.label ?? 'Request'} failed` : isRunning ? 'Executing requests in sequence' : completed ? 'Flow completed' : 'Execution stops on the first failed assertion'}</strong>{failed ? <code>{failureCode}</code> : <small>{repaired ? 'Repair applied · ready to rerun' : 'Responses and extracted variables stay visible here.'}</small>}</span></span>{failed ? inspectorOpen ? <span className="flow-footer-open"><SlidersHorizontal size={15} />Repair ready in inspector</span> : <button className="flow-footer-action" type="button" onClick={onInspectFailure}><Lightning size={16} weight="fill" />Inspect &amp; repair</button> : <span className="flow-footer-progress"><strong>{passedCount}</strong> / {steps.length} passed</span>}</div>
    </section>
  </div>;
}

function FailureEvidence({ step, result }: { step: JourneyStep; result: JourneyStepResult }) {
  const [tab, setTab] = useState<'request' | 'response'>('request');
  const failureCode = result.responseBody?.includes('MISSING_IDEMPOTENCY_KEY') ? 'MISSING_IDEMPOTENCY_KEY' : result.error || `HTTP ${result.actualStatus}`;
  return <section className="failure-evidence" aria-label={`${step.label} failure evidence`}>
    <header className="failure-evidence-header"><span className="failure-step-label"><span>Failed step</span><strong>2</strong><strong>{step.label}</strong></span><div className="failure-evidence-tabs" role="tablist" aria-label="Failure evidence"><button className={tab === 'request' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'request'} onClick={() => setTab('request')}>Request</button><button className={tab === 'response' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'response'} onClick={() => setTab('response')}>Response</button></div></header>
    <div className="failure-request-line"><span className={methodClass(step.method)}>{step.method}</span><code>{result.requestUrl ?? step.url}</code><span className="failure-http-status">{result.actualStatus} Bad Request</span><small>{result.durationMs} ms</small></div>
    {tab === 'request' ? <div className="failure-evidence-grid"><section><h3>Headers</h3>{step.headers?.map(([key, value]) => <div className="evidence-kv" key={key}><span>{key}</span><code>{value}</code></div>)}</section><section><h3>Request body</h3><pre>{formatPayload(result.requestBody ?? step.body)}</pre></section></div> : <div className="failure-response"><span>{failureCode}</span><pre>{formatPayload(result.responseBody)}</pre></div>}
  </section>;
}

function FlowList({ steps, results, selectedStepId, setSelectedStepId, isRunning }: { steps: JourneyStep[]; results: JourneyStepResult[]; selectedStepId: string; setSelectedStepId: (id: string) => void; isRunning: boolean }) {
  const [expandedStepId, setExpandedStepId] = useState<string | null>(steps[0]?.id ?? null);
  return <div className="flow-list">{steps.map((step, index) => {
    const result = results.find((candidate) => candidate.id === step.id);
    const running = isRunning && index === results.length;
    const expanded = expandedStepId === step.id;
    const preview = result?.responseBody ? formatPayload(result.responseBody).replace(/\s+/g, ' ').slice(0, 120) : result ? 'No response body' : 'Not run yet';
    return <article className={`flow-step${selectedStepId === step.id ? ' selected' : ''}${result ? ` ${result.status}` : ''}${running ? ' running' : ''}`} key={step.id}><button className="flow-step-summary" type="button" aria-expanded={expanded} onClick={() => { setSelectedStepId(step.id); setExpandedStepId(expanded ? null : step.id); }}><span className="step-index">{result?.status === 'passed' ? <Check size={15} /> : result?.status === 'failed' ? <X size={15} /> : index + 1}</span><span className={methodClass(step.method)}>{step.method}</span><span className="step-copy"><strong>{step.label}</strong><code>{result?.requestUrl ?? step.url}</code><small>{preview}</small></span><span className="step-output">{step.extracts?.map((item) => <span className="variable-chip" key={item.key}>{item.key}</span>)}{result ? <small>{result.actualStatus} · {result.durationMs} ms</small> : <small>Expect {step.expectedStatus}</small>}</span><CaretDown className={`step-caret${expanded ? ' expanded' : ''}`} size={16} /></button>{expanded && <div className="flow-step-detail"><section><span>Request</span><code>{step.method} {result?.requestUrl ?? step.url}</code><pre>{formatPayload(result?.requestBody ?? step.body)}</pre></section><section><span>Response {result ? `· ${result.actualStatus} · ${result.durationMs} ms` : ''}</span><pre>{result ? formatPayload(result.responseBody) : 'Run the flow to capture this response.'}</pre></section>{result?.extracted && Object.keys(result.extracted).length > 0 && <footer><span>Extracted</span>{Object.entries(result.extracted).map(([key, value]) => <code key={key}>{key} = {value}</code>)}</footer>}</div>}</article>;
  })}</div>;
}

function FlowCanvas({ steps, edges, positions, results, selectedStepId, setSelectedStepId, moveNode, isRunning }: { steps: JourneyStep[]; edges: JourneyFlowEdge[]; positions: JourneyNodePosition[]; results: JourneyStepResult[]; selectedStepId: string; setSelectedStepId: (id: string) => void; moveNode: (id: string, x: number, y: number) => void; isRunning: boolean }) {
  const drag = useRef<{ id: string; pointerId: number; startX: number; startY: number; x: number; y: number } | null>(null);
  const viewport = fitJourneyViewport(positions);
  const byId = new Map(viewport.positions.map((position) => [position.id, position]));
  const storedById = new Map(positions.map((position) => [position.id, position]));
  return <section className="flow-map" aria-label="Executable API workflow">
    <div className="flow-map-stage" style={{ width: viewport.width, height: viewport.height }}>
      <svg className="flow-map-edges" width={viewport.width} height={viewport.height} aria-hidden="true"><defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" /></marker></defs>{edges.map((edge, index) => { const from = byId.get(edge.from); const to = byId.get(edge.to); if (!from || !to) return null; const sourceResult = results.find((result) => result.id === edge.from); const running = isRunning && index === results.length - 1; const labelWidth = Math.min(156, Math.max(58, edge.label.length * 7 + 20)); const labelX = (from.x + FLOW_NODE_WIDTH + to.x) / 2; const labelY = Math.max(4, Math.min(from.y, to.y) - 28); return <g className={`flow-map-edge ${sourceResult?.status ?? (running ? 'running' : 'idle')}`} key={edge.id}><path d={flowEdgePath(from, to)} /><g className="flow-edge-label"><rect x={labelX - labelWidth / 2} y={labelY} width={labelWidth} height="22" rx="11" /><text x={labelX} y={labelY + 15}>{edge.label}</text></g></g>; })}</svg>
      {steps.map((step, index) => { const position = byId.get(step.id); const storedPosition = storedById.get(step.id); if (!position || !storedPosition) return null; const result = results.find((candidate) => candidate.id === step.id); const running = isRunning && index === results.length; return <button className={`flow-node${selectedStepId === step.id ? ' selected' : ''}${result ? ` ${result.status}` : ''}${running ? ' running' : ''}`} type="button" style={{ transform: `translate(${position.x}px, ${position.y}px)` }} key={step.id} onClick={() => setSelectedStepId(step.id)} onPointerDown={(event) => { setSelectedStepId(step.id); drag.current = { id: step.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: storedPosition.x, y: storedPosition.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { const active = drag.current; if (!active || active.id !== step.id || active.pointerId !== event.pointerId) return; moveNode(step.id, active.x + event.clientX - active.startX, active.y + event.clientY - active.startY); }} onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} aria-label={`${step.label}, ${step.method}, expect ${step.expectedStatus}`}>
        <span className="flow-node-top"><span className={methodClass(step.method)}>{step.method}</span><span className="flow-node-index">{result?.status === 'passed' ? <Check size={13} /> : result?.status === 'failed' ? <X size={13} /> : index + 1}</span></span><strong>{step.label}</strong><code>{step.url}</code><span className="flow-node-bottom"><span>{step.extracts?.length ? step.extracts.map(({ key }) => `{{${key}}}`).join(' · ') : `Expect ${step.expectedStatus}`}</span><small className={result?.status === 'failed' ? 'node-status-error' : ''}>{result ? `${result.actualStatus} · ${result.status === 'failed' ? 'failed' : `${result.durationMs} ms`}` : running ? 'Running…' : 'Ready'}</small></span>
      </button>; })}
    </div>
  </section>;
}

function RunResults({ run, burstCount, setBurstCount, burstConcurrency, setBurstConcurrency, burstResult, isBurstRunning, onBurst, onOpenJourney }: { run: RunRecord | null; burstCount: number; setBurstCount: (value: number) => void; burstConcurrency: number; setBurstConcurrency: (value: number) => void; burstResult: BurstResult | null; isBurstRunning: boolean; onBurst: () => Promise<BurstResult | null>; onOpenJourney: () => void }) {
  const failed = run?.results.find((result) => result.status === 'failed');
  const steps = run?.steps ?? [];
  return <div className="runs-screen"><div className="screen-heading"><div><p className="breadcrumb">Runs / {run?.flowName ?? 'API flows'}</p><h1>{run ? (run.status === 'passed' ? 'Flow passed' : 'Flow needs attention') : 'Run results'}</h1><p className="screen-subtitle">Inspect every request and response, then verify behavior under a controlled GET burst.</p></div>{run && <span className={`run-status-large ${run.status}`}>{run.status === 'passed' ? <CheckCircle size={18} weight="fill" /> : <XCircle size={18} weight="fill" />}{run.status}</span>}</div>{!run ? <div className="empty-state run-empty"><CloudArrowDown size={30} /><strong>No flow result yet</strong><span>Run either API flow first. Its step-by-step result will appear here.</span><button className="button primary" type="button" onClick={onOpenJourney}>Open flows</button></div> : <><div className="run-metrics"><Metric label="Total duration" value={`${run.durationMs} ms`} /><Metric label="Passed steps" value={`${run.results.filter((item) => item.status === 'passed').length}/${steps.length}`} /><Metric label="Failures" value={failed ? '1' : '0'} tone={failed ? 'bad' : 'good'} /><Metric label="Started" value={new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} /></div><section className="result-timeline"><div className="section-heading"><div><p className="eyebrow">Execution trace</p><h2>Step results</h2></div><span>{run.status === 'failed' ? 'Stopped at first failure' : 'All steps completed'}</span></div>{steps.map((step, index) => { const result = run.results.find((candidate) => candidate.id === step.id); return <div className={`result-row ${result?.status ?? 'skipped'}`} key={step.id}><span className="result-icon">{result?.status === 'passed' ? <Check size={14} /> : result?.status === 'failed' ? <X size={14} /> : index + 1}</span><span className={methodClass(step.method)}>{step.method}</span><span><strong>{step.label}</strong><small>{result ? `${result.actualStatus} · ${result.durationMs} ms` : 'Not run'}</small></span>{result?.status === 'failed' && <span className="error-code">{result.responseBody?.includes('MISSING_IDEMPOTENCY_KEY') ? 'MISSING_IDEMPOTENCY_KEY' : result.error || 'Assertion failed'}</span>}</div>; })}</section></>}<section className="burst-card"><div className="section-heading"><div><p className="eyebrow">Controlled burst</p><h2>GET reliability check</h2></div><span className="safe-badge"><Check size={13} />GET only · capped at 50</span></div><div className="burst-controls"><label>Requests<input type="number" min="1" max="50" value={burstCount} onChange={(event) => setBurstCount(Number(event.target.value))} /></label><label>Concurrency<input type="number" min="1" max="10" value={burstConcurrency} onChange={(event) => setBurstConcurrency(Number(event.target.value))} /></label><button className="button dark" type="button" onClick={onBurst} disabled={isBurstRunning}>{isBurstRunning ? <ArrowsClockwise className="spin" size={16} /> : <Pulse size={16} />}{isBurstRunning ? 'Running burst' : 'Run controlled burst'}</button></div>{burstResult && <div className="burst-metrics"><Metric label="Success rate" value={`${burstResult.successRate}%`} tone={burstResult.successRate === 100 ? 'good' : 'bad'} /><Metric label="p50" value={`${burstResult.p50} ms`} /><Metric label="p95" value={`${burstResult.p95} ms`} /><Metric label="Errors" value={String(burstResult.errors)} tone={burstResult.errors ? 'bad' : 'good'} /></div>}</section></div>;
}

function Metric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) { return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>; }
function RequestInspector({ variables, response }: { variables: EnvironmentVariable[]; response: ApiResponse | null }) { return <div className="inspector-content"><section><h3>Active variables</h3>{variables.map((variable) => <div className="inspector-kv" key={variable.key}><code>{variable.key}</code><span>{variable.value}</span></div>)}</section><section><h3>Resolved request</h3><div className="note-card"><Code size={16} /><span>Variables resolve only at run time. The templated request stays editable.</span></div></section><section><h3>Latest response</h3>{response ? <><div className="inspector-stat"><span>Status</span><strong>{response.status}</strong></div><div className="inspector-stat"><span>Duration</span><strong>{response.durationMs} ms</strong></div><div className="inspector-stat"><span>Size</span><strong>{response.sizeBytes} B</strong></div></> : <p className="muted-copy">No response captured yet.</p>}</section></div>; }
function RepairSession({ step, result, isRunning, onReject, onApproveAndRun }: { step: JourneyStep; result?: JourneyStepResult; isRunning: boolean; onReject: () => void; onApproveAndRun: () => Promise<JourneyStepResult[]> }) {
  const failureCode = result?.responseBody?.includes('MISSING_IDEMPOTENCY_KEY') ? 'MISSING_IDEMPOTENCY_KEY' : result?.error || `HTTP ${result?.actualStatus ?? 400}`;
  return <div className="repair-session">
    <div className="repair-agent"><span><Robot size={16} weight="fill" /><strong>Agent (WebMCP)</strong></span><small><span className="presence-dot" />Active</small></div>
    <section className="repair-diagnosis"><span className="repair-diagnosis-icon"><Lightning size={17} weight="fill" /></span><div><strong>Missing Idempotency-Key header</strong><p>The API requires an idempotency key to safely create orders.</p><code>{failureCode}</code></div></section>
    <section className="repair-proposal"><h3>Proposed change</h3><p>Add a generated <code>Idempotency-Key</code> header to {step.label}.</p><div className="repair-compare"><div><span>Before · failing</span><code>Content-Type: application/json</code><code className="repair-removed">− Idempotency-Key</code></div><div><span>After · proposed</span><code>Content-Type: application/json</code><code className="repair-added">+ Idempotency-Key: {'{{$uuid}}'}</code></div></div><div className="repair-generated"><span>Generated value</span><code>{'{{$uuid}}'}</code></div></section>
    <section className="repair-rationale"><div><span>Agent note</span><small>Bounded repair</small></div><p>The upstream 400 identifies one missing replay guard. This change is limited to the failed request; the flow will rerun from a clean customer.</p></section>
    <footer className="repair-actions"><button className="button ghost" type="button" onClick={onReject} disabled={isRunning}>Reject</button><button className="button primary" type="button" onClick={() => void onApproveAndRun()} disabled={isRunning}>{isRunning ? <ArrowsClockwise className="spin" size={15} /> : <Play size={14} weight="fill" />}{isRunning ? 'Rerunning' : 'Approve & rerun'}</button><small>This updates the request and reruns the full flow.</small></footer>
  </div>;
}
function StepInspector({ step, result, failed, repaired, onRepair }: { step: JourneyStep; result?: JourneyStepResult; failed: boolean; repaired: boolean; onRepair: () => void }) { const missingHeader = step.id === 'create-order' && !repaired; return <div className="inspector-content"><section><span className={methodClass(step.method)}>{step.method}</span><h3 className="step-title">{step.label}</h3><code className="endpoint-code">{step.url}</code></section><section><h3>Request setup</h3><div className="inspector-stat"><span>Expected status</span><strong>{step.expectedStatus}</strong></div><div className="inspector-stat"><span>Headers</span><strong>{step.headers?.length ?? 0}</strong></div><div className="inspector-stat"><span>Extractions</span><strong>{step.extracts?.length ?? 0}</strong></div></section>{step.extracts?.length ? <section><h3>Extract values</h3>{step.extracts.map((item) => <div className="extraction" key={item.key}><code>{item.key}</code><ArrowDown size={13} /><code>{item.path}</code></div>)}</section> : null}{(failed || missingHeader) && <section className="repair-card"><div className="repair-heading"><WarningCircle size={18} weight="fill" /><div><strong>Missing idempotency key</strong><span>Create order requires a unique replay guard.</span></div></div><div className="repair-diff"><span>+ Idempotency-Key</span><code>{'{{$uuid}}'}</code></div><button className="button primary full" type="button" onClick={onRepair} disabled={repaired}>{repaired ? <Check size={16} /> : <Lightning size={16} />}{repaired ? 'Repair applied' : 'Apply repair'}</button></section>}{result && <section><h3>Latest result</h3><div className={`result-summary ${result.status}`}>{result.status === 'passed' ? <CheckCircle size={18} weight="fill" /> : <XCircle size={18} weight="fill" />}<span><strong>{result.actualStatus}</strong>{result.durationMs} ms</span></div></section>}<div className="agent-note"><Robot size={16} /><span>Every inspector change is visible to the WebMCP agent.</span></div></div>; }
function RunInspector({ run, burst }: { run: RunRecord | null; burst: BurstResult | null }) { return <div className="inspector-content"><section><h3>Selected run</h3>{run ? <><div className="inspector-stat"><span>Outcome</span><strong className={run.status}>{run.status}</strong></div><div className="inspector-stat"><span>Duration</span><strong>{run.durationMs} ms</strong></div><div className="inspector-stat"><span>Completed</span><strong>{run.results.length} steps</strong></div></> : <p className="muted-copy">No run selected.</p>}</section><section><h3>Burst guardrails</h3><div className="note-card"><CheckCircle size={16} /><span>GET only, 50 requests maximum, 10 concurrent requests maximum.</span></div></section>{burst && <section><h3>Last burst</h3><div className="inspector-stat"><span>Success</span><strong>{burst.successRate}%</strong></div><div className="inspector-stat"><span>p95</span><strong>{burst.p95} ms</strong></div></section>}</div>; }
