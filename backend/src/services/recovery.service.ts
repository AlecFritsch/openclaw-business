import { getDatabase } from '../config/database.js';
import { deploymentService } from './deployment.service.js';

class RecoveryService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  start() {
    if (this.intervalId) return;
    
    console.log('[recovery] Starting automatic recovery service (every 30s)');
    
    // Run immediately on start
    this.recoverStuckAgents();
    
    // Then every 30 seconds
    this.intervalId = setInterval(() => {
      this.recoverStuckAgents();
    }, 30000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[recovery] Stopped automatic recovery service');
    }
  }

  private async recoverStuckAgents() {
    if (this.isRunning) return; // Prevent overlapping runs
    
    this.isRunning = true;
    
    try {
      const db = getDatabase();
      const agentsCollection = db.collection('agents');
      
      // Find agents stuck in 'deploying' state for more than 2 minutes
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      
      const stuckAgents = await agentsCollection.find({
        status: 'deploying',
        updatedAt: { $lt: twoMinutesAgo },
      }).toArray();
      
      if (stuckAgents.length > 0) {
        console.log(`[recovery] Found ${stuckAgents.length} stuck agent(s), attempting recovery...`);
      }
      
      for (const agent of stuckAgents) {
        try {
          console.log(`[recovery] Recovering agent ${agent._id}`);
          
          // First try to recover existing container
          const recovered = await deploymentService.recoverDeployingAgent(agent._id.toString());
          
          if (recovered) {
            await agentsCollection.updateOne(
              { _id: agent._id },
              {
                $set: {
                  status: 'running',
                  containerId: recovered.containerId,
                  internalPort: recovered.gatewayPort,
                  gatewayToken: recovered.gatewayToken,
                  gatewayUrl: `ws://127.0.0.1:${recovered.gatewayPort}`,
                  updatedAt: new Date(),
                  errorMessage: undefined,
                },
              }
            );
            console.log(`[recovery] ✓ Agent ${agent._id} recovered from existing container`);
          } else {
            // No existing container, deploy fresh
            console.log(`[recovery] No existing container, deploying fresh for agent ${agent._id}`);
            
            const result = await deploymentService.deployAgent({
              agentId: agent._id.toString(),
              userId: agent.userId,
              organizationId: agent.organizationId,
              name: agent.name,
              description: agent.description || '',
              model: agent.config.model,
              systemPrompt: agent.config.systemPrompt,
              skills: agent.config.skills || [],
              channels: agent.channels?.map((c: any) => ({ type: c.type })) || [],
              useCase: agent.useCase || 'general',
              browserEnabled: agent.config.browserEnabled ?? true,
              heartbeatEnabled: agent.config.heartbeatEnabled ?? true,
              lobsterEnabled: agent.config.lobsterEnabled ?? true,
            });
            
            await agentsCollection.updateOne(
              { _id: agent._id },
              {
                $set: {
                  status: 'running',
                  containerId: result.containerId,
                  internalPort: result.gatewayPort,
                  gatewayToken: result.gatewayToken,
                  gatewayUrl: `ws://127.0.0.1:${result.gatewayPort}`,
                  updatedAt: new Date(),
                  errorMessage: undefined,
                },
              }
            );
            console.log(`[recovery] ✓ Agent ${agent._id} deployed successfully`);
          }
        } catch (error) {
          console.error(`[recovery] Error recovering agent ${agent._id}:`, error);
          
          // Mark as error after 3 failed attempts (6 minutes)
          const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
          if (agent.updatedAt < sixMinutesAgo) {
            await agentsCollection.updateOne(
              { _id: agent._id },
              {
                $set: {
                  status: 'error',
                  errorMessage: error instanceof Error ? error.message : 'Deployment failed',
                  updatedAt: new Date(),
                },
              }
            );
            console.log(`[recovery] Marked agent ${agent._id} as error after multiple failures`);
          }
        }
      }
    } catch (error) {
      console.error('[recovery] Error in recovery service:', error);
    } finally {
      this.isRunning = false;
    }
  }
}

export const recoveryService = new RecoveryService();
