import type { EngineResponse } from 'commons/src/index';
import type { DBEventInput, WSEvent } from 'commons/src/engine-event';
import type { RequestToEngineSchema } from '../zod/z';
import type { z } from 'zod';

export type CommandOf<Action extends EngineCommand["action"]> = Extract<
  EngineCommand,
  { action: Action }
>;

export type WSEventDraft<Event extends WSEvent = WSEvent> = Event extends WSEvent
  ? Pick<Event, "event_type" | "data">
  : never;

export type DBEventDraft = Pick<DBEventInput, "event_type" | "changes">;

export type EngineCommandResult = {
  response: EngineResponse;
  dbEvents: DBEventDraft[];
  wsEvents: WSEventDraft[];
};

export type EngineCommand = z.output<typeof RequestToEngineSchema>;
