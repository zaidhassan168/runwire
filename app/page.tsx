'use client';

import {
  ArrowDown, ArrowsClockwise, BracketsCurly, CaretDown, Check, CheckCircle, Clock,
  CloudArrowDown, CloudArrowUp, Code, DownloadSimple, FloppyDisk, GearSix, Lightning, List,
  MagnifyingGlass, Play, Plus, Pulse, Robot, SlidersHorizontal, TerminalWindow, Trash,
  WarningCircle, X, XCircle,
} from '@phosphor-icons/react';
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoLayoutJourney, buildJourneyEdges, FLOW_NODE_WIDTH, flowEdgePath, JourneyFlowEdge, JourneyNodePosition, moveJourneyNode, normalizeJourneyPositions } from '../lib/flow';
import { JourneyStep, JourneyStepResult, runJourneySequence } from '../lib/journey';
import { ApiCollection, exportPostmanCollection, importPostmanCollection } from '../lib/postman';
import { applyRequestAuth, EnvironmentVariable, isLocalRequestUrl, isRequestAuthConfigured, isSensitiveVariableKey, mergeEnvironmentVariables, protectSensitiveHeaders, RequestAuth, resolveTemplate, withoutSensitiveHeaders } from '../lib/workspace';

type View = 'requests' | 'journeys' | 'runs';
type JourneyMode = 'map' | 'list';
type FlowId = 'checkout' | 'tickets';
type EditorTab = 'Params' | 'Auth' | 'Headers' | 'Body' | 'Tests';
type ApiResponse = { requestUrl: string; requestBody?: string; status: number; statusText: string; headers: [string, string][]; body: string; durationMs: number; sizeBytes: number; truncated: boolean };
type FlowDefinition = { id: FlowId; name: string; collection: string; description: string; steps: JourneyStep[] };
type RunRecord = { id: string; flowId: FlowId; flowName: string; steps: JourneyStep[]; startedAt: string; status: 'passed' | 'failed'; durationMs: number; results: JourneyStepResult[] };
type BurstResult = { count: number; successRate: number; p50: number; p95: number; errors: number };
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
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeEditorTab, setActiveEditorTab] = useState<EditorTab>('Headers');
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [responseTab, setResponseTab] = useState<'Body' | 'Headers'>('Body');
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [maxDurationMs, setMaxDurationMs] = useState(1500);
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
  const [userInitials, setUserInitials] = useState('··');
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
      if (result.status === 401) { window.location.assign('/signin-with-chatgpt?return_to=/'); return; }
      const payload = await result.json() as { state: SavedWorkspace | null; user?: { displayName: string } };
      if (cancelled) return;
      if (payload.user?.displayName) setUserInitials(payload.user.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase());
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

  const runJourney = useCallback(async () => {
    if (!workspaceReady || isJourneyRunning) return [];
    setView('journeys'); setIsJourneyRunning(true); setJourneyResults([]); setRequestError('');
    const started = performance.now();
    try {
      const results = await runJourneySequence(journeySteps, (step, runtime) => executeRequest(step, runtime), setJourneyResults);
      const run: RunRecord = { id: crypto.randomUUID(), flowId: activeFlow.id, flowName: activeFlow.name, steps: journeySteps, startedAt: new Date().toISOString(), status: results.length === journeySteps.length && results.every((result) => result.status === 'passed') ? 'passed' : 'failed', durationMs: Math.round(performance.now() - started), results };
      setRuns((current) => [run, ...current].slice(0, 20)); setSelectedRunId(run.id);
      const failed = results.find((result) => result.status === 'failed'); if (failed) setSelectedStepId(failed.id);
      return results;
    } catch (error) { setRequestError(error instanceof Error ? error.message : 'Flow failed.'); return []; }
    finally { setIsJourneyRunning(false); }
  }, [activeFlow.id, activeFlow.name, executeRequest, isJourneyRunning, journeySteps, workspaceReady]);

  const applyRepair = useCallback(() => { setJourneyRepaired(true); setSelectedStepId('create-order'); setJourneyMode('map'); setRequestError(''); }, []);
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
    const media = window.matchMedia('(max-width: 1180px)');
    const closePanels = (event: MediaQueryListEvent) => { if (event.matches) { setNavigatorOpen(false); setInspectorOpen(false); } };
    media.addEventListener('change', closePanels);
    return () => media.removeEventListener('change', closePanels);
  }, []);

  useEffect(() => {
    if (typeof document.modelContext?.registerTool !== 'function') return;
    const controller = new AbortController(); const emptySchema = { type: 'object', properties: {}, additionalProperties: false }; const register = document.modelContext.registerTool.bind(document.modelContext);
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
    ]).catch(() => undefined);
    return () => controller.abort();
  }, [activeFlow, applyRepair, auth, autoLayoutFlow, body, burstConcurrency, burstCount, burstResult, expectedStatus, headers, journeyEdges, journeyPositions, journeyRepaired, journeyResults, journeySteps, method, moveFlowNode, render, requestError, response, runBurst, runJourney, runs, selectFlow, selectedStepId, sendRequest, url]);

  const failedJourneyResult = journeyResults.find((result) => result.status === 'failed');
  const selectedResult = journeyResults.find((result) => result.id === selectedStep.id);
  const passedCount = journeyResults.filter((result) => result.status === 'passed').length;

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">R</span><span>Runwire</span><span className="workspace-pill">API workspace</span></div><div className="topbar-center"><span className="presence-dot" />Shared with agent <span className="sync-copy">· changes stay visible both ways</span></div><div className="topbar-actions"><button className="button ghost env-button" type="button" onClick={() => setEnvironmentOpen((open) => !open)}><span className="presence-dot" />{environmentName}<CaretDown size={14} /></button><button className="icon-button" type="button" aria-label="Save workspace" onClick={saveWorkspace} disabled={!workspaceReady || saveStatus === 'saving'}><FloppyDisk size={18} /></button><span className="avatar">{userInitials}</span></div></header>
    {environmentOpen && <EnvironmentPanel name={environmentName} setName={setEnvironmentName} variables={variables} setVariables={setVariables} onClose={() => setEnvironmentOpen(false)} />}
    <div className={`workspace-layout${navigatorOpen ? '' : ' navigator-closed'}${inspectorOpen ? '' : ' inspector-closed'}`}>
      <nav className="icon-rail" aria-label="Workspace sections"><div className="rail-main"><RailButton label="Requests" active={view === 'requests'} onClick={() => setView('requests')}><TerminalWindow size={20} /></RailButton><RailButton label="Flows" active={view === 'journeys'} onClick={() => setView('journeys')}><BracketsCurly size={20} /></RailButton><RailButton label="Runs" active={view === 'runs'} onClick={() => setView('runs')}><Pulse size={20} /></RailButton></div><RailButton label="Environment" onClick={() => setEnvironmentOpen(true)}><GearSix size={20} /></RailButton></nav>
      <Navigator view={view} filterQuery={filterQuery} setFilterQuery={setFilterQuery} visibleCollections={visibleCollections} requestName={requestName} collectionName={collectionName} openCollectionRequest={openCollectionRequest} importInput={importInput} importCollection={importCollection} exportActiveCollection={exportActiveCollection} onClose={() => setNavigatorOpen(false)} activeFlowId={activeFlowId} onSelectFlow={selectFlow} runs={runs} selectedRun={selectedRun} setSelectedRunId={setSelectedRunId} />
      {!navigatorOpen && <button className="edge-toggle left" type="button" aria-label="Open navigator" onClick={() => setNavigatorOpen(true)}><List size={16} /></button>}
      <section className="main-canvas">
        {view === 'requests' && <RequestWorkspace method={method} setMethod={setMethod} url={url} setUrl={setUrl} body={body} setBody={setBody} headers={headers} setHeaders={setHeaders} auth={auth} setAuth={setAuth} requestName={requestName} setRequestName={setRequestName} collectionName={collectionName} activeTab={activeEditorTab} setActiveTab={setActiveEditorTab} expectedStatus={expectedStatus} setExpectedStatus={setExpectedStatus} maxDurationMs={maxDurationMs} setMaxDurationMs={setMaxDurationMs} response={response} responseTab={responseTab} setResponseTab={setResponseTab} formattedBody={formattedBody} requestError={requestError} assertionResults={assertionResults} isSending={isSending} workspaceReady={workspaceReady} onSend={sendRequest} saveStatus={saveStatus} />}
        {view === 'journeys' && <JourneyBuilder flow={activeFlow} edges={journeyEdges} positions={journeyPositions} results={journeyResults} selectedStepId={selectedStep.id} setSelectedStepId={setSelectedStepId} moveNode={moveFlowNode} mode={journeyMode} setMode={setJourneyMode} autoLayout={autoLayoutFlow} isRunning={isJourneyRunning} passedCount={passedCount} onRun={runJourney} repaired={journeyRepaired} />}
        {view === 'runs' && <RunResults run={selectedRun} burstCount={burstCount} setBurstCount={setBurstCount} burstConcurrency={burstConcurrency} setBurstConcurrency={setBurstConcurrency} burstResult={burstResult} isBurstRunning={isBurstRunning} onBurst={() => runBurst()} onOpenJourney={() => setView('journeys')} />}
      </section>
      <aside className="inspector"><div className="panel-title-row"><div><p className="eyebrow">Inspector</p><h2>{view === 'requests' ? 'Environment' : view === 'journeys' ? 'Node details' : 'Run details'}</h2></div><button className="icon-button compact" type="button" aria-label="Collapse inspector" onClick={() => setInspectorOpen(false)}><X size={16} /></button></div>{view === 'requests' && <RequestInspector variables={variables} response={response} />}{view === 'journeys' && <StepInspector step={selectedStep} result={selectedResult} failed={failedJourneyResult?.id === selectedStep.id} repaired={journeyRepaired} onRepair={applyRepair} />}{view === 'runs' && <RunInspector run={selectedRun} burst={burstResult} />}</aside>
      {!inspectorOpen && <button className="edge-toggle right" type="button" aria-label="Open inspector" onClick={() => setInspectorOpen(true)}><SlidersHorizontal size={16} /></button>}
    </div>
  </main>;
}

function RailButton({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) { return <button className={`rail-button${active ? ' active' : ''}`} type="button" onClick={onClick} aria-label={label} aria-current={active ? 'page' : undefined}>{children}<span>{label}</span></button>; }

function Navigator({ view, filterQuery, setFilterQuery, visibleCollections, requestName, collectionName, openCollectionRequest, importInput, importCollection, exportActiveCollection, onClose, activeFlowId, onSelectFlow, runs, selectedRun, setSelectedRunId }: { view: View; filterQuery: string; setFilterQuery: (value: string) => void; visibleCollections: ApiCollection[]; requestName: string; collectionName: string; openCollectionRequest: (collection: ApiCollection, id: string) => void; importInput: React.RefObject<HTMLInputElement | null>; importCollection: (event: ChangeEvent<HTMLInputElement>) => void; exportActiveCollection: () => void; onClose: () => void; activeFlowId: FlowId; onSelectFlow: (id: FlowId) => void; runs: RunRecord[]; selectedRun: RunRecord | null; setSelectedRunId: (id: string) => void }) {
  return <aside className="navigator"><div className="panel-title-row"><div><p className="eyebrow">Workspace</p><h2>{view === 'requests' ? 'Collections' : view === 'journeys' ? 'Flows' : 'Run history'}</h2></div><button className="icon-button compact" type="button" aria-label="Collapse navigator" onClick={onClose}><List size={17} /></button></div>
    {view === 'requests' && <><label className="search"><MagnifyingGlass size={15} /><input value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} placeholder="Filter requests" /></label><div className="navigator-scroll">{visibleCollections.map((collection) => <section className="collection" key={collection.id}><h3>{collection.name}<span>{collection.requests.length}</span></h3>{collection.requests.map((request) => { const active = request.name === requestName && collection.name === collectionName; return <button className={`request-item${active ? ' active' : ''}`} type="button" key={request.id} onClick={() => openCollectionRequest(collection, request.id)}><span className={methodClass(request.method)}>{request.method}</span><span>{request.name}</span></button>; })}</section>)}</div><input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={importCollection} /><div className="navigator-actions"><button className="button ghost" type="button" onClick={() => importInput.current?.click()}><DownloadSimple size={15} />Import</button><button className="button ghost" type="button" onClick={exportActiveCollection}><CloudArrowUp size={15} />Export</button></div></>}
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
  formattedBody: string; requestError: string; assertionResults: { label: string; passed: boolean }[]; isSending: boolean; workspaceReady: boolean; onSend: (event?: FormEvent) => Promise<ApiResponse | null>; saveStatus: string;
};
function RequestWorkspace(props: RequestWorkspaceProps) {
  const tabs: EditorTab[] = ['Params', 'Auth', 'Headers', 'Body', 'Tests'];
  return <div className="request-screen">
    <div className="screen-heading"><div><p className="breadcrumb">{props.collectionName} / Request</p><input className="title-input" value={props.requestName} onChange={(event) => props.setRequestName(event.target.value)} aria-label="Request name" /></div><span className="agent-badge"><Robot size={14} />15 agent tools</span></div>
    <form className="request-composer" onSubmit={props.onSend}><select className={methodClass(props.method)} value={props.method} onChange={(event) => props.setMethod(event.target.value)} aria-label="HTTP method"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select><input className="url-input" value={props.url} onChange={(event) => props.setUrl(event.target.value)} aria-label="Request URL" spellCheck={false} /><button className="button primary send" type="submit" disabled={!props.workspaceReady || props.isSending}>{props.isSending ? <ArrowsClockwise className="spin" size={18} /> : <Play size={17} weight="fill" />}{props.isSending ? 'Sending' : 'Send'}</button></form>
    <p className="shortcut">⌘ Enter to send · {props.saveStatus === 'saved' ? 'workspace saved' : 'local draft'}</p>
    <div className="tab-row" role="tablist">{tabs.map((tab) => <button className={props.activeTab === tab ? 'active' : ''} type="button" role="tab" aria-selected={props.activeTab === tab} onClick={() => props.setActiveTab(tab)} key={tab}>{tab}{tab === 'Headers' && <span>{props.headers.length}</span>}{tab === 'Auth' && props.auth.type !== 'none' && <span>1</span>}</button>)}</div>
    <div className="editor-card">
      {props.activeTab === 'Headers' && <div className="key-value-table"><div className="table-head"><span>Header</span><span>Value</span><span /></div>{props.headers.map(([key, value], index) => <div className="table-row" key={`${key}-${index}`}><input value={key} onChange={(event) => props.setHeaders((current) => current.map((item, itemIndex) => itemIndex === index ? [event.target.value, item[1]] : item))} aria-label={`Header ${index + 1} name`} /><input value={value} onChange={(event) => props.setHeaders((current) => current.map((item, itemIndex) => itemIndex === index ? [item[0], event.target.value] : item))} aria-label={`Header ${index + 1} value`} /><button className="icon-button compact danger" type="button" aria-label={`Remove ${key}`} onClick={() => props.setHeaders((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash size={14} /></button></div>)}<button className="text-button table-add" type="button" onClick={() => props.setHeaders((current) => [...current, ['', '']])}><Plus size={14} />Add header</button></div>}
      {props.activeTab === 'Auth' && <AuthEditor auth={props.auth} setAuth={props.setAuth} />}
      {props.activeTab === 'Body' && <textarea className="code-editor" value={props.body} onChange={(event) => props.setBody(event.target.value)} aria-label="Request body" placeholder="No request body" spellCheck={false} />}
      {props.activeTab === 'Params' && <div className="empty-state mini"><SlidersHorizontal size={22} /><strong>Query parameters live in the URL</strong><span>Use ?key=value and variables like {'{{orderId}}'}.</span></div>}
      {props.activeTab === 'Tests' && <div className="test-fields"><label>Expected status<input type="number" min="100" max="599" value={props.expectedStatus} onChange={(event) => props.setExpectedStatus(Number(event.target.value))} /></label><label>Maximum duration<span className="input-suffix"><input type="number" min="1" max="60000" value={props.maxDurationMs} onChange={(event) => props.setMaxDurationMs(Number(event.target.value))} /><span>ms</span></span></label></div>}
    </div>
    <ResponsePanel response={props.response} responseTab={props.responseTab} setResponseTab={props.setResponseTab} formattedBody={props.formattedBody} requestError={props.requestError} assertions={props.assertionResults} />
  </div>;
}

function AuthEditor({ auth, setAuth }: { auth: RequestAuth; setAuth: React.Dispatch<React.SetStateAction<RequestAuth>> }) {
  const setType = (type: RequestAuth['type']) => setAuth(type === 'bearer' ? { type, token: '' } : type === 'api-key' ? { type, key: 'X-API-Key', value: '', location: 'header' } : type === 'basic' ? { type, username: '', password: '' } : { type: 'none' });
  return <div className="auth-editor"><label className="auth-type">Authentication<select value={auth.type} onChange={(event) => setType(event.target.value as RequestAuth['type'])}><option value="none">No auth</option><option value="bearer">Bearer token</option><option value="api-key">API key</option><option value="basic">Basic auth</option></select></label>{auth.type === 'bearer' && <label>Token<input type="password" value={auth.token} onChange={(event) => setAuth({ ...auth, token: event.target.value })} placeholder="Enter token" autoComplete="off" /></label>}{auth.type === 'basic' && <div className="auth-grid"><label>Username<input value={auth.username} onChange={(event) => setAuth({ ...auth, username: event.target.value })} autoComplete="off" /></label><label>Password<input type="password" value={auth.password} onChange={(event) => setAuth({ ...auth, password: event.target.value })} autoComplete="off" /></label></div>}{auth.type === 'api-key' && <div className="auth-grid api-key-grid"><label>Key<input value={auth.key} onChange={(event) => setAuth({ ...auth, key: event.target.value })} /></label><label>Value<input type="password" value={auth.value} onChange={(event) => setAuth({ ...auth, value: event.target.value })} autoComplete="off" /></label><label>Send in<select value={auth.location} onChange={(event) => setAuth({ ...auth, location: event.target.value as 'header' | 'query' })}><option value="header">Header</option><option value="query">Query string</option></select></label></div>}<p className="auth-note"><WarningCircle size={15} />Credentials stay in this browser tab, are excluded from workspace saves, and are never exposed to the agent.</p></div>;
}

function ResponsePanel({ response, responseTab, setResponseTab, formattedBody, requestError, assertions }: { response: ApiResponse | null; responseTab: 'Body' | 'Headers'; setResponseTab: (tab: 'Body' | 'Headers') => void; formattedBody: string; requestError: string; assertions: { label: string; passed: boolean }[] }) {
  const content = requestError || (responseTab === 'Headers' && response ? response.headers.map(([key, value]) => `${key}: ${value}`).join('\n') : formattedBody) || 'Send a request to inspect the response body, headers, timing, and assertions.';
  return <section className="response-card"><div className="response-header"><div className="response-title"><h2>Response</h2>{response && <><span className={`status-chip ${response.status >= 400 ? 'failed' : 'passed'}`}>{response.status} {response.statusText}</span><span><Clock size={13} />{response.durationMs} ms</span><span>{response.sizeBytes} B</span></>}{requestError && <span className="status-chip failed">Request failed</span>}</div>{response && <div className="segmented"><button className={responseTab === 'Body' ? 'active' : ''} type="button" onClick={() => setResponseTab('Body')}>Body</button><button className={responseTab === 'Headers' ? 'active' : ''} type="button" onClick={() => setResponseTab('Headers')}>Headers</button></div>}</div><pre className={requestError ? 'response-body error' : 'response-body'}><code>{content}</code></pre>{assertions.length > 0 && <div className="assertion-row">{assertions.map((assertion) => <span className={assertion.passed ? 'passed' : 'failed'} key={assertion.label}>{assertion.passed ? <Check size={13} /> : <X size={13} />}{assertion.label}</span>)}</div>}</section>;
}

function JourneyBuilder({ flow, edges, positions, results, selectedStepId, setSelectedStepId, moveNode, mode, setMode, autoLayout, isRunning, passedCount, onRun, repaired }: { flow: FlowDefinition; edges: JourneyFlowEdge[]; positions: JourneyNodePosition[]; results: JourneyStepResult[]; selectedStepId: string; setSelectedStepId: (id: string) => void; moveNode: (id: string, x: number, y: number) => void; mode: JourneyMode; setMode: (mode: JourneyMode) => void; autoLayout: () => void; isRunning: boolean; passedCount: number; onRun: () => Promise<JourneyStepResult[]>; repaired: boolean }) {
  const steps = flow.steps;
  const extractionCount = steps.reduce((total, step) => total + (step.extracts?.length ?? 0), 0);
  return <div className="journey-screen flow-screen">
    <div className="screen-heading"><div><p className="breadcrumb">Flows / {flow.collection}</p><h1>{flow.name}</h1><p className="screen-subtitle">{flow.description} Every request and response remains inspectable in List.</p></div><div className="heading-meta"><span className="agent-badge"><Robot size={14} />Shared live graph</span><button className="button primary" type="button" onClick={onRun} disabled={isRunning}>{isRunning ? <ArrowsClockwise className="spin" size={17} /> : <Play size={16} weight="fill" />}{isRunning ? 'Running' : 'Run flow'}</button></div></div>
    <div className="journey-summary"><div><span className="summary-value">{steps.length}</span><span>executable nodes</span></div><div><span className="summary-value">{extractionCount}</span><span>data bindings</span></div><div><span className="summary-value">{results.length ? `${passedCount}/${steps.length}` : '—'}</span><span>latest result</span></div><div className="progress"><span style={{ width: `${(passedCount / steps.length) * 100}%` }} /></div></div>
    <div className="flow-toolbar"><div className="segmented" role="group" aria-label="Workflow view"><button className={mode === 'map' ? 'active' : ''} type="button" onClick={() => setMode('map')}>Map</button><button className={mode === 'list' ? 'active' : ''} type="button" onClick={() => setMode('list')}>List</button></div><button className="button ghost" type="button" onClick={autoLayout}><ArrowsClockwise size={15} />Auto layout</button></div>
    {mode === 'map'
      ? <FlowCanvas steps={steps} edges={edges} positions={positions} results={results} selectedStepId={selectedStepId} setSelectedStepId={setSelectedStepId} moveNode={moveNode} isRunning={isRunning} />
      : <FlowList key={flow.id} steps={steps} results={results} selectedStepId={selectedStepId} setSelectedStepId={setSelectedStepId} isRunning={isRunning} />}
    <div className="journey-footer"><span><Pulse size={15} />Execution stops on failed status or extraction</span><span>{flow.id === 'checkout' ? (repaired ? 'Repair applied · ready to rerun' : '1 agent repair available') : 'Request and response evidence captured'}</span></div>
  </div>;
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
  const byId = new Map(positions.map((position) => [position.id, position]));
  const width = Math.max(860, ...positions.map(({ x }) => x + 220));
  return <section className="flow-map" aria-label="Executable API workflow">
    <div className="flow-map-stage" style={{ width }}>
      <svg className="flow-map-edges" width={width} height="560" aria-hidden="true"><defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" /></marker></defs>{edges.map((edge, index) => { const from = byId.get(edge.from); const to = byId.get(edge.to); if (!from || !to) return null; const sourceResult = results.find((result) => result.id === edge.from); const running = isRunning && index === results.length - 1; return <g className={`flow-map-edge ${sourceResult?.status ?? (running ? 'running' : 'idle')}`} key={edge.id}><path d={flowEdgePath(from, to)} /><text x={(from.x + FLOW_NODE_WIDTH + to.x) / 2} y={(from.y + to.y) / 2 + 42}>{edge.label}</text></g>; })}</svg>
      {steps.map((step, index) => { const position = byId.get(step.id); if (!position) return null; const result = results.find((candidate) => candidate.id === step.id); const running = isRunning && index === results.length; return <button className={`flow-node${selectedStepId === step.id ? ' selected' : ''}${result ? ` ${result.status}` : ''}${running ? ' running' : ''}`} type="button" style={{ transform: `translate(${position.x}px, ${position.y}px)` }} key={step.id} onClick={() => setSelectedStepId(step.id)} onPointerDown={(event) => { setSelectedStepId(step.id); drag.current = { id: step.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { const active = drag.current; if (!active || active.id !== step.id || active.pointerId !== event.pointerId) return; moveNode(step.id, active.x + event.clientX - active.startX, active.y + event.clientY - active.startY); }} onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} aria-label={`${step.label}, ${step.method}, expect ${step.expectedStatus}`}>
        <span className="flow-node-top"><span className={methodClass(step.method)}>{step.method}</span><span className="flow-node-index">{result?.status === 'passed' ? <Check size={13} /> : result?.status === 'failed' ? <X size={13} /> : index + 1}</span></span><strong>{step.label}</strong><code>{step.url}</code><span className="flow-node-bottom"><span>{step.extracts?.length ? step.extracts.map(({ key }) => `{{${key}}}`).join(' · ') : `Expect ${step.expectedStatus}`}</span><small>{result ? `${result.actualStatus} · ${result.durationMs} ms` : running ? 'Running…' : 'Ready'}</small></span>
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
function StepInspector({ step, result, failed, repaired, onRepair }: { step: JourneyStep; result?: JourneyStepResult; failed: boolean; repaired: boolean; onRepair: () => void }) { const missingHeader = step.id === 'create-order' && !repaired; return <div className="inspector-content"><section><span className={methodClass(step.method)}>{step.method}</span><h3 className="step-title">{step.label}</h3><code className="endpoint-code">{step.url}</code></section><section><h3>Request setup</h3><div className="inspector-stat"><span>Expected status</span><strong>{step.expectedStatus}</strong></div><div className="inspector-stat"><span>Headers</span><strong>{step.headers?.length ?? 0}</strong></div><div className="inspector-stat"><span>Extractions</span><strong>{step.extracts?.length ?? 0}</strong></div></section>{step.extracts?.length ? <section><h3>Extract values</h3>{step.extracts.map((item) => <div className="extraction" key={item.key}><code>{item.key}</code><ArrowDown size={13} /><code>{item.path}</code></div>)}</section> : null}{(failed || missingHeader) && <section className="repair-card"><div className="repair-heading"><WarningCircle size={18} weight="fill" /><div><strong>Missing idempotency key</strong><span>Create order requires a unique replay guard.</span></div></div><div className="repair-diff"><span>+ Idempotency-Key</span><code>{'{{$uuid}}'}</code></div><button className="button primary full" type="button" onClick={onRepair} disabled={repaired}>{repaired ? <Check size={16} /> : <Lightning size={16} />}{repaired ? 'Repair applied' : 'Apply repair'}</button></section>}{result && <section><h3>Latest result</h3><div className={`result-summary ${result.status}`}>{result.status === 'passed' ? <CheckCircle size={18} weight="fill" /> : <XCircle size={18} weight="fill" />}<span><strong>{result.actualStatus}</strong>{result.durationMs} ms</span></div></section>}<div className="agent-note"><Robot size={16} /><span>Every inspector change is visible to the WebMCP agent.</span></div></div>; }
function RunInspector({ run, burst }: { run: RunRecord | null; burst: BurstResult | null }) { return <div className="inspector-content"><section><h3>Selected run</h3>{run ? <><div className="inspector-stat"><span>Outcome</span><strong className={run.status}>{run.status}</strong></div><div className="inspector-stat"><span>Duration</span><strong>{run.durationMs} ms</strong></div><div className="inspector-stat"><span>Completed</span><strong>{run.results.length} steps</strong></div></> : <p className="muted-copy">No run selected.</p>}</section><section><h3>Burst guardrails</h3><div className="note-card"><CheckCircle size={16} /><span>GET only, 50 requests maximum, 10 concurrent requests maximum.</span></div></section>{burst && <section><h3>Last burst</h3><div className="inspector-stat"><span>Success</span><strong>{burst.successRate}%</strong></div><div className="inspector-stat"><span>p95</span><strong>{burst.p95} ms</strong></div></section>}</div>; }
