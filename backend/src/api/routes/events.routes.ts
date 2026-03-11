// Server-Sent Events (SSE) Route - Real-time event streaming to frontend
// Streams gateway events from all connected agents to authenticated clients.

import { FastifyInstance } from 'fastify';
import { gatewayManager } from '../../services/gateway-ws.service.js';
import { getDatabase } from '../../config/database.js';

export async function eventsRoutes(fastify: FastifyInstance) {

  // GET /api/events/stream - SSE endpoint for real-time gateway events
  fastify.get('/stream', {
    schema: {
      tags: ['Events'],
      summary: 'Real-time event stream (SSE)',
      description: 'Server-Sent Events endpoint that streams gateway events for all agents the user has access to.',
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    // Find all agent IDs this user/org has access to
    const db = getDatabase();
    const filter: any = {};
    if (organizationId) {
      filter.organizationId = organizationId;
    } else {
      filter.userId = userId;
    }
    const agents = await db.collection('agents')
      .find(filter, { projection: { _id: 1 } })
      .toArray();
    const agentIds = new Set(agents.map(a => a._id.toString()));

    // Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    });

    // Send initial connection event
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', agentIds: Array.from(agentIds) })}\n\n`);

    // Heartbeat to keep connection alive (every 15s)
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch {
        // Connection closed
        clearInterval(heartbeat);
      }
    }, 15000);

    // Listen for gateway events
    const onEvent = (data: { agentId: string; event: string; payload: any }) => {
      // Only forward events for agents this user has access to
      if (!agentIds.has(data.agentId)) return;

      try {
        const sseData = JSON.stringify({
          type: 'gateway_event',
          agentId: data.agentId,
          event: data.event,
          payload: data.payload,
          timestamp: Date.now(),
        });
        reply.raw.write(`data: ${sseData}\n\n`);
      } catch {
        // Connection closed — will be cleaned up below
      }
    };

    const onAgentConnected = (agentId: string) => {
      if (!agentIds.has(agentId)) return;
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'agent_connected', agentId })}\n\n`);
      } catch { /* closed */ }
    };

    const onAgentDisconnected = (data: { agentId: string }) => {
      if (!agentIds.has(data.agentId)) return;
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'agent_disconnected', agentId: data.agentId })}\n\n`);
      } catch { /* closed */ }
    };

    gatewayManager.on('gateway_event', onEvent);
    gatewayManager.on('agent_connected', onAgentConnected);
    gatewayManager.on('agent_disconnected', onAgentDisconnected);

    // Clean up on disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      gatewayManager.off('gateway_event', onEvent);
      gatewayManager.off('agent_connected', onAgentConnected);
      gatewayManager.off('agent_disconnected', onAgentDisconnected);
    });

    // Don't let Fastify send a response — we're streaming
    return reply;
  });
}
