// Discord API Types
export type DiscordUser = {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
  bot?: boolean;
  system?: boolean;
};

export type DiscordMessage = {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  tts: boolean;
  mention_everyone: boolean;
  mentions: DiscordUser[];
  mention_roles: string[];
  attachments: unknown[];
  embeds: unknown[];
  reactions?: unknown[];
  pinned: boolean;
  type: number;
  // Optional fields
  guild_id?: string;
  member?: unknown;
  webhook_id?: string;
};

export type DiscordChannel = {
  id: string;
  type: number;
  guild_id?: string;
  position?: number;
  name?: string;
  topic?: string | null;
  nsfw?: boolean;
  last_message_id?: string | null;
  bitrate?: number;
  user_limit?: number;
  rate_limit_per_user?: number;
  recipients?: DiscordUser[];
  icon?: string | null;
  owner_id?: string;
  application_id?: string;
  parent_id?: string | null;
};

export type Interaction = {
  id: string;
  type: number; // 1 Ping, 2 Command, 3 Component, 5 ModalSubmit, ...
  token: string;
  application_id: string;
  data?: unknown;
  guild_id?: string;
  channel_id?: string;
  member?: { user: DiscordUser };
  user?: DiscordUser; // when invoked in DM
};

export type MessageParams = {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
  flags?: number; // 64 for ephemeral (ignored in pure DMs)
};

export type Info = {
  userId?: string;
  guildId?: string;
  dmChannel: string;
  discordToken: string;
  isListening: boolean;
};
