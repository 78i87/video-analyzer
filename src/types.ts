// Example structures
export type AgentState = 'active' | 'probation' | 'quit'; // Probation = 1st quit
export type AgentDecision = {
  agentId: string;
  segmentIndex: number;
  decision: 'CONTINUE' | 'QUIT';
  reason: string;
  isSecondQuit: boolean; // Did this trigger the final exit?
};