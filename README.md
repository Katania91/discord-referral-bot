# Referral Bot (Discord.js + SQLite/MySQL) 🎯

Self-hosted **referral / invite system** for Discord servers:

* each member gets their **own invite link**
* they have a limited **token quota per week**
* the bot **verifies** that invited users stay in the server (and keep a role)
* it **rewards** good inviters and exposes a **leaderboard**
* it fights spam/abuse with account-age checks, role gates and expiries

> Ideal for servers running referral campaigns, growth programs, or needing a safer alternative to vanilla Discord invites.

<p>
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 18+" />
  <img src="https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord.js v14" />
  <img src="https://img.shields.io/badge/DB-SQLite%20%7C%20MySQL-003B57?style=for-the-badge&logo=mysql&logoColor=white" alt="SQLite/MySQL" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="MIT License" />
</p>

---

## TL;DR – What this bot does

If you run a server and you want to:

* let members **invite people with their own link**
* **limit spam** with weekly quotas instead of unlimited invites
* only count referrals when the invited user **stays in the server** and gets a specific role
* show a **leaderboard** and give **rewards** at configurable thresholds (default 5 / 15 confirmed referrals)
* avoid abuse from **fresh accounts / alt accounts**

…this bot automates all of that.

Each user:

* gets a **personal invite link**
* has a **weekly pool of tokens** (default 5)
* each valid join consumes **1 token**
* if the invitee passes all checks and stays long enough, the referral is **confirmed**
* confirmed referrals count for **rewards** and **leaderboard**

---

## Features ✨

* 🧾 **Self-service referral links** – each member gets their own invite
* ⏳ **Weekly token quotas** – limit how many joins count per week
* ✅ **Smart confirmation flow** – only confirmed referrals (user stays + keeps role) are rewarded
* 🏆 **Leaderboard** – week / month / all-time rankings
* 🎁 **Configurable rewards** – default thresholds 5 and 15 confirmed referrals, configurable via `.env`
* 🛡️ **Anti-abuse** – account-age check, role gate to create links, deactivated invites at 0 tokens
* 📊 **Logging** – configurable log channel for staff, DM notifications to inviters
* 🕒 **Schedulers** – weekly resets & hourly processing for expiries/confirmations
* 💾 **SQLite (default) or MySQL/MariaDB** with migrations

---

## Tech Stack 🛠️

* **Runtime:** Node.js 18+
* **Discord:** discord.js v14 (slash commands)
* **Database:** SQLite (default) or MySQL/MariaDB
* **Config:** `.env` + `config` table in DB
* **Scheduling:** in-process cron-style jobs (weekly + hourly)

---

## Quick Start (for server owners) 🚀

> You need to be able to run a Node.js bot yourself (this is **not** a hosted/public bot).

### 1. Requirements

* Node.js **18+**
* A **Discord application** + bot token
* Either:

  * **SQLite** (default, file-based, zero setup), or
  * **MySQL/MariaDB** (if you prefer a real DB)

### 2. Discord: intents & permissions

In the **Discord Developer Portal**:

1. Enable **Gateway Intents**:

   * `Guilds`
   * `Guild Members`
   * `Guild Invites`

2. Invite the bot to your server with at least:

   * `Manage Guild`
   * `Manage Channels` (for invites)
   * `View Channels`
   * `Read Message History`
   * `Manage Roles` (if you want the bot to assign/remove roles)

### 3. Minimal server setup

Create the following in your guild:

* **Channels**

  * `#invites` → where users will run `/referral` and see info
  * `#referral-log` → staff-only logs
  * (optional) `#referral-rewards`, `#referral-leaderboard`

* **Roles**

  * `@Required` → role that marks a “valid” referral
    (e.g. your “member” role or a role given after verification)
  * (optional) `@Entry`, `@Invited`, `@Staff`, `@Link Creator`

Make sure the **bot role is above** any role it has to assign/remove.

### 4. Configure `.env` (minimum fields)

Create a `.env` file next to `package.json`:

```env
# Required
DISCORD_TOKEN=your-bot-token
APPLICATION_ID=your-application-id
GUILD_ID=your-guild-id

# Channels (IDs)
INVITE_CHANNEL_ID=123456789012345678      # #invites
LOG_CHANNEL_ID=123456789012345679         # #referral-log

# Roles (IDs)
REQUIRED_ROLE_ID=123456789012345680       # @Required

# Behavior
TIMEZONE=Europe/Rome
DB_ENGINE=sqlite                          # sqlite or mysql
ENFORCE_BOT_INVITES=0
REWARD_TIER1=5                            # first reward threshold (confirmed referrals)
REWARD_TIER2=15                           # second reward threshold (confirmed referrals)
```

This is enough to get started.
All other variables are optional and documented below.

### 5. Install & run

```bash
npm install
npm run register   # register slash commands (guild-scoped if GUILD_ID is set); rerun after you add/change commands
npm start          # start the bot
```

Once the bot is online (`npm start`), your users can start with:

* `/referral link` → get their personal invite link

From there, the bot automatically tracks joins, confirmations, and updates the leaderboard based on your configuration.

---

## Full .env reference 🧩

```env
# Required
DISCORD_TOKEN=your-bot-token
APPLICATION_ID=your-application-id

# Recommended for testing (guild-scoped command registration)
GUILD_ID=your-guild-id

# Channels (IDs)
INVITE_CHANNEL_ID=
LOG_CHANNEL_ID=
REWARD_CHANNEL_ID=
LEADERBOARD_CHANNEL_ID=

# Roles (IDs)
REQUIRED_ROLE_ID=          # role that validates a referral (needed for confirmations)
ENTRY_ROLE_ID=             # optional: assigned on join
INVITED_ROLE_ID=           # optional: assigned on join; removed on expiry
LINK_CREATOR_ROLE_ID=      # optional: who can create personal invites
STAFF_ROLE_ID=             # optional: who can use staff commands / get tagged on rewards
REMOVE_ON_VALIDATE_ROLE_ID=# optional: role to remove when validated

# Behavior
TIMEZONE=Europe/Rome
DB_ENGINE=sqlite           # or mysql
ENFORCE_BOT_INVITES=0      # 1 to enforce bot-created invites only
REWARD_TIER1=5             # first reward threshold (confirmed referrals)
REWARD_TIER2=15            # second reward threshold (confirmed referrals)

# MySQL (set DB_ENGINE=mysql to use these)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=referral_bot
```

* **SQLite (default)**: DB file at `data/referral.db` is created automatically.
* **MySQL/MariaDB**: apply `data/schema.sql`, set `DB_ENGINE=mysql` and `MYSQL_*`.

---

## Slash Commands 🎮

### User commands

* `/referral link`
  Show or create your personal invite and how many tokens you have left this week.

* `/referral stats`
  Show your pending / confirmed / failed referrals and token balance.

* `/referral leaderboard [period]`
  Show the leaderboard for `week | month | all`.
  Can be ephemeral when used in the invite channel.

### Admin / staff commands

* `/admin set-hold <days>`
  Set how many days a user must keep the required role before a referral is auto-confirmed.

* `/admin grant-tokens <user> <n>`
  Add or remove tokens (negative values remove).

* `/admin reset-tokens`
  Force a weekly reset now.

* `/staff validate <user>`
  Manually validate a referral by assigning the required role (bypasses waiting).

* `/staff who-invited <user>`
  Show who invited a user and the referral status.

* `/staff invited <user> [status] [limit]`
  List referrals by inviter.

* `/staff process-referrals [force_confirm]`
  Process expiries/holdings immediately.

* `/staff check-confirmations`
  Confirm holdings that completed the hold period.

* `/staff check-pending`
  Show remaining time for holdings.

---

## Referral lifecycle (how tokens flow) 🔄

1. **Join**

   * A user joins via a personal invite.
   * The inviter spends **1 token**.
   * Referral state: `pending` with a TTL (default 7 days).

2. **Gets required role**

   * Invited user receives `REQUIRED_ROLE_ID` (e.g. passes verification).
   * Referral becomes `holding` for *hold days* (default 7 days).

3. **Outcome**

   * If the user still has the required role at the end of hold → referral becomes **confirmed**.
   * If they leave / lose the role / TTL expires → referral becomes **failed** and the token is **refunded**.

States:

* `pending` → waiting for required role or expiry
* `holding` → waiting for hold period to complete
* `confirmed` → counts for rewards & leaderboard
* `failed` → no reward, token refunded

---

## Leaderboard & rewards 🏆

* Leaderboard supports **week / month / all-time** views.
* Default reward tiers:

  * **5 confirmed** referrals
  * **15 confirmed** referrals
    You can change these thresholds via `REWARD_TIER1` and `REWARD_TIER2` in your `.env`.
* You can:

  * post rewards in `REWARD_CHANNEL_ID`
  * optionally ping `STAFF_ROLE_ID` when someone reaches a milestone.

---

## Anti-abuse features 🛡️

* Minimum **account age** check (configurable in DB/config).
* Optional **role gate** to be allowed to create personal links (`LINK_CREATOR_ROLE_ID`).
* Invites are **deactivated** when a user hits 0 tokens:

  * joins no longer count until tokens are reset.
* Automatic **role cleanup** when referrals expire or fail.

---

## Schedulers (automation) ⏱️

The bot runs scheduled jobs:

* **Weekly** (Monday 00:00 in `TIMEZONE`):

  * reset weekly tokens.

* **Hourly**:

  * expire `pending` referrals past TTL
  * process `holding` referrals (confirm or fail)
  * refund tokens on failures
  * update roles and leaderboard on confirmations

---

## Project structure (example) 📁

```text
commands/
  admin.js
  referral.js
  staff.js
db.js
index.js
inviteCache.js
registerCommands.js
scheduler.js
schema.sql

.env.example
package.json
README.md
```

---

## Notes for production 📌

* Keep the **bot role above** any role it should assign/remove.
* Use `GUILD_ID` during testing to avoid global command propagation delay;
  remove it when you’re ready for global registration.
* Leaderboard embed is auto-upserted:

  * channel/message IDs are stored in config when first sent.

---

## License 📜

This project is licensed under the **MIT License**.
See the `LICENSE` file for details.
