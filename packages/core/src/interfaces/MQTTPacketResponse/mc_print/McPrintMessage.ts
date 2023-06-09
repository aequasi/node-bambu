export type MCPrintMessageCommands = 'push_info';

export interface MCPrintMessage {
  mc_print: MCPrintMessageCommand;
}

export type MCPrintMessageCommand = {
  command: MCPrintMessageCommands;
} & Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isMCPrintMessage(data: any): data is MCPrintMessage {
  return !!data?.mc_print && !!data?.mc_print?.command && ['push_info'].includes(data.mc_print.command);
}
