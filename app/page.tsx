'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EnvironmentVariable, isSensitiveVariableKey, mergeEnvironmentVariables, resolveTemplate } from '../lib/workspace';
import { ApiCollection, exportPostmanCollection, importPostmanCollection } from '../lib/postman';
import { JourneyStep, JourneyStepResult, runJourneySequence } from '../lib/journey';

const starterCollections: ApiCollection[] = [
  {
    id: 'catalog',
    name: 'Catalog',
    requests: [
      { id: 'get-product-7', name: 'Get product 7', method: 'GET', url: '{{baseUrl}}/objects/7', headers: [['Accept', 'application/json']], body: '' },
      { id: 'get-products', name: 'Get products', method: 'GET', url: '{{baseUrl}}/objects?id=3&id=5', headers: [['Accept', 'application/json']], body: '' },
      { id: 'missing-product', name: 'Missing product', method: 'GET', url: '{{baseUrl}}/objects/does-not-exist', headers: [['Accept', 'application/json']], body: '' },
    ],
  },
  {
    id: 'products-write',
    name: 'Product writes',
    requests: [
      { id: 'create-product', name: 'Create product', method: 'POST', url: '{{baseUrl}}/objects', headers: [['Content-Type', 'application/json']], body: '{\n  "name": "Journey notebook",\n  "data": { "color": "blue" }\n}' },
      { id: 'update-product', name: 'Update product 7', method: 'PUT', url: '{{baseUrl}}/objects/7', headers: [['Content-Type', 'application/json']], body: '{\n  "name": "Journey notebook",\n  "data": { "color": "blue" }\n}' },
    ],
  },
];

const journeySteps: JourneyStep[] = [
  { id: 'product-7', label: 'Get product 7', method: 'GET', url: '{{baseUrl}}/objects/7', expectedStatus: 200 },
  { id: 'product-3', label: 'Get product 3', method: 'GET', url: '{{baseUrl}}/objects/3', expectedStatus: 200 },
  { id: 'missing-product', label: 'Verify missing product', method: 'GET', url: '{{baseUrl}}/objects/does-not-exist', expectedStatus: 404 },
];

const defaultHeaders: [string, string][] = [['Accept', 'application/json']];

type ApiResponse = {
  requestUrl: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  durationMs: number;
  sizeBytes: number;
  truncated: boolean;
};

type SavedWorkspace = {
  activeRequest: { method: string; url: string; body: string; headers?: [string, string][]; name?: string; collection?: string };
  environment: { name: string; variables: EnvironmentVariable[] };
  importedCollections?: ApiCollection[];
  assertions?: { expectedStatus: number; maxDurationMs: number };
};

const defaultEnvironment: EnvironmentVariable[] = [
  { key: 'baseUrl', value: 'https://api.restful-api.dev' },
];

export default function Home() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('{{baseUrl}}/objects/7');
  const [body, setBody] = useState('');
  const [headers, setHeaders] = useState<[string, string][]>(defaultHeaders);
  const [requestName, setRequestName] = useState('Get product 7');
  const [collectionName, setCollectionName] = useState('Catalog');
  const [importedCollections, setImportedCollections] = useState<ApiCollection[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [environmentName, setEnvironmentName] = useState('Local Sandbox');
  const [variables, setVariables] = useState<EnvironmentVariable[]>(defaultEnvironment);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [activeEditorTab, setActiveEditorTab] = useState('Headers');
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [responseTab, setResponseTab] = useState<'Body' | 'Headers'>('Body');
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [maxDurationMs, setMaxDurationMs] = useState(1500);
  const [requestError, setRequestError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [journeyResults, setJourneyResults] = useState<JourneyStepResult[]>([]);
  const [isJourneyRunning, setIsJourneyRunning] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [userInitials, setUserInitials] = useState('··');
  const importInput = useRef<HTMLInputElement>(null);

  const formattedBody = useMemo(() => {
    if (!response?.body) return '';
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  }, [response]);

  const assertionResults = useMemo(() => response ? [
    { label: `Status is ${expectedStatus}`, passed: response.status === expectedStatus },
    { label: `Duration < ${maxDurationMs} ms`, passed: response.durationMs < maxDurationMs },
  ] : [], [expectedStatus, maxDurationMs, response]);

  const passedJourneySteps = journeyResults.filter((result) => result.status === 'passed').length;

  useEffect(() => {
    const wideLayout = window.matchMedia('(min-width: 1181px)');
    const syncPanels = () => {
      setCollectionsOpen(wideLayout.matches);
      setJourneyOpen(wideLayout.matches);
    };
    syncPanels();
    wideLayout.addEventListener('change', syncPanels);
    return () => wideLayout.removeEventListener('change', syncPanels);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/workspace').then(async (result) => {
      if (result.status === 401) {
        window.location.assign('/signin-with-chatgpt?return_to=/');
        return;
      }
      const payload = await result.json() as { state: SavedWorkspace | null; user?: { displayName: string } };
      if (cancelled) return;
      if (payload.user?.displayName) {
        setUserInitials(payload.user.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase());
      }
      if (payload.state?.activeRequest) {
        setMethod(payload.state.activeRequest.method);
        setUrl(payload.state.activeRequest.url);
        setBody(payload.state.activeRequest.body ?? '');
        if (payload.state.activeRequest.headers?.length) setHeaders(payload.state.activeRequest.headers);
        if (payload.state.activeRequest.name) setRequestName(payload.state.activeRequest.name);
        if (payload.state.activeRequest.collection) setCollectionName(payload.state.activeRequest.collection);
      }
      if (payload.state?.environment) {
        setEnvironmentName(payload.state.environment.name);
        setVariables(mergeEnvironmentVariables(defaultEnvironment, payload.state.environment.variables));
      }
      if (Array.isArray(payload.state?.importedCollections)) setImportedCollections(payload.state.importedCollections);
      if (payload.state?.assertions) {
        setExpectedStatus(payload.state.assertions.expectedStatus);
        setMaxDurationMs(payload.state.assertions.maxDurationMs);
      }
    }).catch(() => {
      if (!cancelled) setSaveStatus('error');
    }).finally(() => {
      if (!cancelled) setWorkspaceReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  const saveWorkspace = useCallback(async () => {
    if (variables.some(({ key }) => isSensitiveVariableKey(key))) {
      setSaveStatus('error');
      setRequestError('Secrets are not persisted in this local prototype. Remove secret-like environment variables before saving.');
      return;
    }
    setSaveStatus('saving');
    try {
      const result = await fetch('/api/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeRequest: { method, url, body, headers, name: requestName, collection: collectionName },
          environment: { name: environmentName, variables },
          importedCollections,
          assertions: { expectedStatus, maxDurationMs },
        } satisfies SavedWorkspace),
      });
      if (result.status === 401) {
        window.location.assign('/signin-with-chatgpt?return_to=/');
        return;
      }
      if (!result.ok) throw new Error('Save failed.');
      setSaveStatus('saved');
      window.setTimeout(() => setSaveStatus('idle'), 1800);
    } catch {
      setSaveStatus('error');
    }
  }, [body, collectionName, environmentName, expectedStatus, headers, importedCollections, maxDurationMs, method, requestName, url, variables]);

  const sendRequest = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    if (!workspaceReady) return null;
    setIsSending(true);
    setRequestError('');
    try {
      const resolvedUrl = resolveTemplate(url, variables);
      const resolvedBody = resolveTemplate(body, variables);
      const resolvedHeaders = headers
        .filter(([key, value]) => key.trim() && value.trim())
        .map(([key, value]) => [key, resolveTemplate(value, variables)]);
      const result = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, url: resolvedUrl, headers: resolvedHeaders, body: resolvedBody }),
      });
      if (result.status === 401) {
        window.location.assign('/signin-with-chatgpt?return_to=/');
        return null;
      }
      const payload = await result.json() as ApiResponse & { error?: string };
      if (!result.ok || payload.error) throw new Error(payload.error ?? 'Request failed.');
      setResponse(payload);
      setResponseTab('Body');
      return payload;
    } catch (error) {
      setResponse(null);
      setRequestError(error instanceof Error ? error.message : 'Request failed.');
      return null;
    } finally {
      setIsSending(false);
    }
  }, [body, headers, method, url, variables, workspaceReady]);

  const runJourney = useCallback(async () => {
    if (!workspaceReady) return [];
    setIsJourneyRunning(true);
    setJourneyResults([]);
    try {
      const results = await runJourneySequence(journeySteps, async (step) => {
        const result = await fetch('/api/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: step.method,
            url: resolveTemplate(step.url, variables),
            headers: defaultHeaders,
            body: '',
          }),
        });
        if (result.status === 401) {
          window.location.assign('/signin-with-chatgpt?return_to=/');
          throw new Error('Sign in required.');
        }
        const payload = await result.json() as ApiResponse & { error?: string };
        if (!result.ok || payload.error) throw new Error(payload.error ?? 'Journey request failed.');
        return payload;
      }, setJourneyResults);
      return results;
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Journey failed.');
      return [];
    } finally {
      setIsJourneyRunning(false);
    }
  }, [variables, workspaceReady]);

  async function importCollection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const collection = importPostmanCollection(JSON.parse(await file.text()));
      setImportedCollections((current) => [...current, collection]);
      const firstRequest = collection.requests[0];
      setCollectionName(collection.name);
      setRequestName(firstRequest.name);
      setMethod(firstRequest.method);
      setUrl(firstRequest.url);
      setHeaders(firstRequest.headers.length ? firstRequest.headers : defaultHeaders);
      setBody(firstRequest.body);
      setRequestError('');
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Collection could not be imported.');
    }
  }

  function openCollectionRequest(collection: ApiCollection, requestId: string) {
    const request = collection.requests.find((candidate) => candidate.id === requestId);
    if (!request) return;
    setCollectionName(collection.name);
    setRequestName(request.name);
    setMethod(request.method);
    setUrl(request.url);
    setHeaders(request.headers.length ? request.headers : defaultHeaders);
    setBody(request.body);
    setExpectedStatus(request.id === 'missing-product' ? 404 : 200);
    setResponse(null);
    setRequestError('');
    if (window.matchMedia('(max-width: 1180px)').matches) setCollectionsOpen(false);
  }

  const visibleCollections = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return [...starterCollections, ...importedCollections];
    return [...starterCollections, ...importedCollections]
      .map((collection) => ({
        ...collection,
        requests: collection.requests.filter((request) => `${collection.name} ${request.name} ${request.method}`.toLowerCase().includes(query)),
      }))
      .filter((collection) => collection.requests.length > 0);
  }, [filterQuery, importedCollections]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void sendRequest();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sendRequest]);

  function exportActiveCollection() {
    const collection: ApiCollection = {
      id: 'active',
      name: collectionName,
      requests: [{ id: 'active-request', name: requestName, method, url, headers, body }],
    };
    const blob = new Blob([JSON.stringify(exportPostmanCollection(collection), null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = `${collectionName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'collection'}.postman_collection.json`;
    anchor.click();
    URL.revokeObjectURL(downloadUrl);
  }

  useEffect(() => {
    if (typeof document.modelContext?.registerTool !== 'function') return;
    const controller = new AbortController();
    const emptySchema = { type: 'object', properties: {}, additionalProperties: false };

    void Promise.all([
      document.modelContext.registerTool({
        name: 'get_active_request',
        title: 'Get active API request',
        description: 'Read the method, templated URL, resolved URL, body, and active environment for the request currently open in Journey.',
        inputSchema: emptySchema,
        annotations: { readOnlyHint: true },
        execute: () => ({
          method,
          url,
          resolvedUrl: resolveTemplate(url, variables),
          body,
          environment: { name: environmentName, variableKeys: variables.map((variable) => variable.key) },
        }),
      }, { signal: controller.signal }),
      document.modelContext.registerTool({
        name: 'get_journey',
        title: 'Get API journey',
        description: 'Read the ordered requests, expected statuses, and latest results in the visible Journey runner.',
        inputSchema: emptySchema,
        annotations: { readOnlyHint: true },
        execute: () => ({ steps: journeySteps, results: journeyResults }),
      }, { signal: controller.signal }),
      document.modelContext.registerTool({
        name: 'run_journey',
        title: 'Run API journey',
        description: 'Run the visible API journey in order through the protected server-side executor, stop at the first failed status assertion, and update each visible step.',
        inputSchema: emptySchema,
        execute: async () => ({ results: await runJourney() }),
      }, { signal: controller.signal }),
      document.modelContext.registerTool({
        name: 'set_response_assertions',
        title: 'Set response assertions',
        description: 'Set the expected HTTP status and maximum response duration for the active request. Results appear in the visible Tests and Response panels.',
        inputSchema: {
          type: 'object',
          properties: {
            expectedStatus: { type: 'integer', minimum: 100, maximum: 599 },
            maxDurationMs: { type: 'integer', minimum: 1, maximum: 60000 },
          },
          additionalProperties: false,
        },
        execute: (input) => {
          if (typeof input.expectedStatus === 'number') setExpectedStatus(input.expectedStatus);
          if (typeof input.maxDurationMs === 'number') setMaxDurationMs(input.maxDurationMs);
          setActiveEditorTab('Tests');
          return { updated: true, expectedStatus: input.expectedStatus ?? expectedStatus, maxDurationMs: input.maxDurationMs ?? maxDurationMs };
        },
      }, { signal: controller.signal }),
      document.modelContext.registerTool({
        name: 'update_active_request',
        title: 'Update active API request',
        description: 'Update the method, URL, or body of the request currently visible in Journey. The human sees the change immediately. Omitted fields remain unchanged.',
        inputSchema: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
            url: { type: 'string', minLength: 1, maxLength: 2048 },
            body: { type: 'string', maxLength: 256000 },
          },
          additionalProperties: false,
        },
        execute: (input) => {
          if (typeof input.method === 'string') setMethod(input.method);
          if (typeof input.url === 'string') setUrl(input.url);
          if (typeof input.body === 'string') setBody(input.body);
          return { updated: true, fields: Object.keys(input) };
        },
      }, { signal: controller.signal }),
      document.modelContext.registerTool({
        name: 'run_active_request',
        title: 'Run active API request',
        description: 'Execute the request currently open in Journey through its protected server-side runner and update the visible response panel with the real result.',
        inputSchema: emptySchema,
        execute: async () => {
          const result = await sendRequest();
          if (!result) return { executed: false, error: 'The request failed. Inspect the visible response panel or call get_last_response.' };
          return { executed: true, status: result.status, statusText: result.statusText, durationMs: result.durationMs, sizeBytes: result.sizeBytes };
        },
      }, { signal: controller.signal }),
      document.modelContext.registerTool({
        name: 'get_last_response',
        title: 'Get latest API response',
        description: 'Read the real status, headers, body, timing, and size from the latest request run in the visible Journey workspace.',
        inputSchema: emptySchema,
        annotations: { readOnlyHint: true },
        execute: () => response ? {
          ...response,
          body: response.body.slice(0, 100000),
          bodyTruncatedForAgent: response.body.length > 100000,
        } : { available: false, message: requestError || 'No request has been run yet.' },
      }, { signal: controller.signal }),
      document.modelContext.registerTool({
        name: 'set_environment_variable',
        title: 'Set non-sensitive environment variable',
        description: 'Set a non-sensitive variable in the active Journey environment. Do not use this tool for passwords, tokens, API keys, authorization values, or other secrets.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]*$', maxLength: 80 },
            value: { type: 'string', maxLength: 4096 },
          },
          required: ['key', 'value'],
          additionalProperties: false,
        },
        execute: (input) => {
          if (typeof input.key !== 'string' || typeof input.value !== 'string') throw new Error('A variable key and value are required.');
          if (isSensitiveVariableKey(input.key)) throw new Error('Sensitive variables must be entered through the protected human flow.');
          setVariables((current) => {
            const existing = current.findIndex((variable) => variable.key === input.key);
            if (existing === -1) return [...current, { key: input.key as string, value: input.value as string }];
            return current.map((variable, index) => index === existing ? { key: input.key as string, value: input.value as string } : variable);
          });
          setEnvironmentOpen(true);
          return { updated: true, key: input.key, environment: environmentName };
        },
      }, { signal: controller.signal }),
    ]).catch(() => undefined);

    return () => controller.abort();
  }, [body, environmentName, expectedStatus, journeyResults, maxDurationMs, method, requestError, response, runJourney, sendRequest, url, variables]);

  return (
    <main className="workbench">
      <header className="topbar">
        <div className="topbar-left">
          <button className="panel-toggle" type="button" onClick={() => setCollectionsOpen((open) => !open)} aria-expanded={collectionsOpen} aria-controls="collections-panel" aria-label="Collections">
            <span aria-hidden="true">☰</span><span>Collections</span>
          </button>
          <div className="brand" aria-label="Journey API workspace">
            <span className="brand-mark">J</span>
            <span>Journey</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="quiet-button journey-toggle" type="button" onClick={() => setJourneyOpen((open) => !open)} aria-expanded={journeyOpen} aria-controls="journey-panel">Journey</button>
          <button className="quiet-button environment-button" type="button" onClick={() => setEnvironmentOpen((open) => !open)} aria-expanded={environmentOpen}>
            <span className="status-dot" /> {environmentName}
          </button>
          <button className="quiet-button" type="button" onClick={saveWorkspace} disabled={!workspaceReady || saveStatus === 'saving'}>
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Retry save' : 'Save workspace'}
          </button>
          <span className="avatar" aria-label={`Signed in as ${userInitials}`}>{userInitials}</span>
        </div>
      </header>

      {environmentOpen && (
        <section className="environment-panel" aria-label="Environment variables">
          <div className="panel-heading">
            <div>
              <p className="overline">Active environment</p>
              <input className="environment-name" value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} aria-label="Environment name" />
            </div>
            <button className="icon-button" type="button" onClick={() => setEnvironmentOpen(false)} aria-label="Close environment">×</button>
          </div>
          <p className="security-note">Non-sensitive values only. Secret storage comes before deployment.</p>
          <div className="variable-labels"><span>Variable</span><span>Value</span><span /></div>
          <div className="variable-list">
            {variables.map((variable, index) => (
              <div className="variable-row" key={`${variable.key}-${index}`}>
                <input value={variable.key} onChange={(event) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} aria-label={`Variable ${index + 1} name`} />
                <input value={variable.value} onChange={(event) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} aria-label={`Variable ${index + 1} value`} />
                <button className="remove-button" type="button" onClick={() => setVariables((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${variable.key || 'variable'}`}>×</button>
              </div>
            ))}
          </div>
          <button className="text-button" type="button" onClick={() => setVariables((current) => [...current, { key: '', value: '' }])}>Add variable</button>
        </section>
      )}

      {(collectionsOpen || journeyOpen) && <button className="drawer-backdrop" type="button" onClick={() => { setCollectionsOpen(false); setJourneyOpen(false); }} aria-label="Close panels" />}

      <div className={`app-layout${collectionsOpen ? '' : ' sidebar-closed'}${journeyOpen ? '' : ' journey-closed'}`}>
        <aside className="collections-panel" id="collections-panel" aria-label="API collections">
          <div className="panel-heading compact-heading">
            <h1>Collections</h1>
            <button className="icon-button" type="button" onClick={() => setCollectionsOpen(false)} aria-label="Collapse collections">×</button>
          </div>
          <label className="filter-field">
            <span aria-hidden="true">⌕</span>
            <input value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} aria-label="Filter collections" placeholder="Filter requests" />
          </label>
          <nav className="collection-list">
            {visibleCollections.map((collection) => (
              <section className="collection" key={collection.id}>
                <h2><span>{collection.name}</span><small>{collection.requests.length}</small></h2>
                <ul>
                  {collection.requests.map((request) => {
                    const active = request.name === requestName && collection.name === collectionName;
                    return (
                      <li key={request.id}>
                        <button className={`request-link${active ? ' active' : ''}`} type="button" onClick={() => openCollectionRequest(collection, request.id)} aria-current={active ? 'page' : undefined} disabled={!workspaceReady}>
                          <span className={`method-label method-${request.method.toLowerCase()}`}>{request.method}</span>
                          <span>{request.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {visibleCollections.length === 0 && <p className="empty-filter">No matching requests.</p>}
          </nav>
          <input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={importCollection} />
          <div className="collection-actions">
            <button className="quiet-button" type="button" onClick={() => importInput.current?.click()}>Import</button>
            <button className="quiet-button" type="button" onClick={exportActiveCollection}>Export</button>
          </div>
        </aside>

        <section className="request-workspace" aria-label="Request editor">
          <div className="request-heading">
            <div>
              <p className="breadcrumb">{collectionName}</p>
              <input className="request-name" value={requestName} onChange={(event) => setRequestName(event.target.value)} aria-label="Request name" />
            </div>
            {(!workspaceReady || saveStatus === 'saved' || saveStatus === 'error') && <span className={`save-state save-${saveStatus}`}>{!workspaceReady ? 'Loading…' : saveStatus === 'saved' ? 'Saved' : 'Not saved'}</span>}
          </div>

          <form className="request-bar" onSubmit={sendRequest}>
            <label>
              <span className="visually-hidden">HTTP method</span>
              <select value={method} onChange={(event) => setMethod(event.target.value)} aria-label="HTTP method">
                <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
              </select>
            </label>
            <label className="url-field">
              <span className="visually-hidden">Request URL</span>
              <input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Request URL" spellCheck={false} />
            </label>
            <button className="send-button" type="submit" disabled={!workspaceReady || isSending}>{isSending ? 'Sending…' : 'Send'}</button>
          </form>
          <p className="shortcut-hint">Press ⌘ Enter to send</p>

          <div className="editor-tabs" role="tablist" aria-label="Request configuration">
            {['Params', 'Headers', 'Body', 'Tests'].map((tab) => (
              <button className={activeEditorTab === tab ? 'active' : ''} type="button" role="tab" aria-selected={activeEditorTab === tab} onClick={() => setActiveEditorTab(tab)} key={tab}>
                {tab}{tab === 'Headers' && <span>{headers.filter(([key]) => key.trim()).length}</span>}
              </button>
            ))}
          </div>

          <div className="editor-panel">
            {activeEditorTab === 'Headers' && (
              <div className="headers-table" role="table" aria-label="Request headers">
                <div className="headers-head" role="row"><span role="columnheader">Header</span><span role="columnheader">Value</span><span /></div>
                {headers.map(([key, value], index) => (
                  <div className="header-row" role="row" key={`${index}-${key}`}>
                    <input value={key} onChange={(event) => setHeaders((current) => current.map((header, headerIndex) => headerIndex === index ? [event.target.value, header[1]] : header))} aria-label={`Header ${index + 1} name`} placeholder="Header name" />
                    <input value={value} onChange={(event) => setHeaders((current) => current.map((header, headerIndex) => headerIndex === index ? [header[0], event.target.value] : header))} aria-label={`${key || `Header ${index + 1}`} value`} placeholder="Value" />
                    <button className="remove-button" type="button" onClick={() => setHeaders((current) => current.filter((_, headerIndex) => headerIndex !== index))} aria-label={`Remove ${key || 'header'}`}>×</button>
                  </div>
                ))}
                <button className="text-button table-action" type="button" onClick={() => setHeaders((current) => [...current, ['', '']])}>Add header</button>
              </div>
            )}
            {activeEditorTab === 'Body' && (
              <label className="body-editor"><span className="visually-hidden">Request body</span><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={'{\n  "name": "Example"\n}'} spellCheck={false} /></label>
            )}
            {activeEditorTab === 'Params' && <div className="params-note"><strong>Query parameters live in the URL.</strong><span>Example: <code>?status=active&amp;limit=10</code></span></div>}
            {activeEditorTab === 'Tests' && (
              <div className="tests-grid">
                <label>Expected status<input type="number" min="100" max="599" value={expectedStatus} onChange={(event) => setExpectedStatus(Number(event.target.value))} /></label>
                <label>Maximum duration (ms)<input type="number" min="1" max="60000" value={maxDurationMs} onChange={(event) => setMaxDurationMs(Number(event.target.value))} /></label>
              </div>
            )}
          </div>

          <section className="response-panel" aria-label="Latest response">
            <div className="response-toolbar">
              <div className="response-summary">
                <h2>Response</h2>
                {response && <><span className={`status-code ${response.status >= 400 ? 'bad' : 'good'}`}>{response.status} {response.statusText}</span><span>{response.durationMs} ms</span><span>{response.sizeBytes} B</span></>}
                {requestError && <span className="status-code bad">Request failed</span>}
              </div>
              {response && <div className="response-tabs" role="tablist" aria-label="Response view">
                {(['Body', 'Headers'] as const).map((tab) => <button className={responseTab === tab ? 'active' : ''} type="button" role="tab" aria-selected={responseTab === tab} onClick={() => setResponseTab(tab)} key={tab}>{tab}</button>)}
              </div>}
            </div>
            <pre className={requestError ? 'response-code error' : 'response-code'}><code>{requestError || (responseTab === 'Headers' && response ? response.headers.map(([key, value]) => `${key}: ${value}`).join('\n') : formattedBody) || 'Send a request to inspect the real API response.'}</code></pre>
            {assertionResults.length > 0 && <div className="assertions">{assertionResults.map((assertion) => <span className={assertion.passed ? 'passed' : 'failed'} key={assertion.label}>{assertion.passed ? '✓' : '×'} {assertion.label}</span>)}</div>}
          </section>
        </section>

        <aside className="journey-panel" id="journey-panel" aria-label="Catalog health journey">
          <div className="panel-heading">
            <h2>Catalog health</h2>
            <button className="icon-button" type="button" onClick={() => setJourneyOpen(false)} aria-label="Collapse journey">×</button>
          </div>
          <p className="journey-status">{isJourneyRunning ? 'Running…' : journeyResults.length ? `${passedJourneySteps} of ${journeySteps.length} passed` : `${journeySteps.length} steps`}</p>
          <div className="progress-track"><span style={{ width: `${(passedJourneySteps / journeySteps.length) * 100}%` }} /></div>
          <ol className="journey-steps">
            {journeySteps.map((step, index) => {
              const result = journeyResults.find((candidate) => candidate.id === step.id);
              const isActive = isJourneyRunning && index === journeyResults.length;
              return (
                <li className={result?.status ?? (isActive ? 'running' : '')} key={step.id}>
                  <span className="step-number">{result?.status === 'passed' ? '✓' : result?.status === 'failed' ? '!' : index + 1}</span>
                  <div><strong>{step.label}</strong><span>{result ? `${result.actualStatus} · ${result.durationMs} ms` : `Expect ${step.expectedStatus}`}</span></div>
                </li>
              );
            })}
          </ol>
          <button className="journey-button" type="button" onClick={runJourney} disabled={!workspaceReady || isJourneyRunning}>{isJourneyRunning ? 'Running journey…' : 'Run all 3 steps'}</button>
        </aside>
      </div>
    </main>
  );
}
