const { Collection } = require('discord.js');

class InviteCache {
  constructor() {
    this.byGuild = new Collection(); // guildId -> Collection(code -> uses)
  }

  seed(guildId, invites) {
    const map = new Collection();
    for (const invite of invites.values()) {
      if (!invite.code) continue;
      map.set(invite.code, invite.uses ?? 0);
    }
    this.byGuild.set(guildId, map);
  }

  updateOnCreate(guildId, invite) {
    if (!this.byGuild.has(guildId)) this.byGuild.set(guildId, new Collection());
    this.byGuild.get(guildId).set(invite.code, invite.uses ?? 0);
  }

  updateOnDelete(guildId, code) {
    this.byGuild.get(guildId)?.delete(code);
  }

  detectUsedInvite(guildId, freshInvites) {
    // Compare cached uses vs fresh snapshot
    const before = this.byGuild.get(guildId) || new Collection();
    const after = new Collection();
    for (const invite of freshInvites.values()) after.set(invite.code, invite.uses ?? 0);

    let used = null;
    for (const [code, usesAfter] of after) {
      const usesBefore = before.get(code) ?? 0;
      if (usesAfter > usesBefore) {
        used = freshInvites.get(code) ?? { code, uses: usesAfter };
        break; // assume single increase
      }
    }

    // Update cache to latest snapshot
    this.byGuild.set(guildId, after);
    return used; // may be null if not determinable
  }
}

module.exports = { InviteCache };

