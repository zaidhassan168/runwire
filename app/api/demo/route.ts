export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const id = url.searchParams.get('id');
  if (action === 'get_order') {
    if (!id) return Response.json({ error: 'orderId is required.' }, { status: 400 });
    return Response.json({ id, customerId: url.searchParams.get('customerId') ?? 'cus_demo_01', status: 'created', total: 99.98, currency: 'USD' });
  }
  if (action === 'get_ticket') {
    if (!id) return Response.json({ error: 'ticketId is required.' }, { status: 400 });
    return Response.json({ id, subject: 'Cannot sign in after MFA', priority: 'high', status: 'open' });
  }
  return Response.json({ error: 'Unknown demo action.' }, { status: 404 });
}

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get('action');
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;

  if (action === 'create_customer') {
    return Response.json({ id: `cus_${crypto.randomUUID().slice(0, 8)}`, name: payload.name ?? 'Ada Lovelace' }, { status: 201 });
  }
  if (action === 'create_order') {
    if (!request.headers.get('Idempotency-Key')) {
      return Response.json({ code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required to create an order.' }, { status: 400 });
    }
    return Response.json({ id: `ord_${crypto.randomUUID().slice(0, 8)}`, customerId: payload.customerId, status: 'created', total: 99.98 }, { status: 201 });
  }
  if (action === 'create_ticket') {
    return Response.json({ id: `tkt_${crypto.randomUUID().slice(0, 8)}`, subject: payload.subject, priority: payload.priority ?? 'normal', status: 'open' }, { status: 201 });
  }
  return Response.json({ error: 'Unknown demo action.' }, { status: 404 });
}

export async function PATCH(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (url.searchParams.get('action') !== 'close_ticket' || !id) {
    return Response.json({ error: 'ticketId is required.' }, { status: 400 });
  }
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  return Response.json({ id, status: 'closed', resolution: payload.resolution ?? 'Resolved' });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('action') !== 'delete_order' || !url.searchParams.get('id')) {
    return Response.json({ error: 'orderId is required.' }, { status: 400 });
  }
  return new Response(null, { status: 204 });
}
