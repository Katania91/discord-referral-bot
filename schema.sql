-- Referral bot schema (MariaDB/MySQL)
-- Tables: config, users, invites, referrals, rewards_awarded

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS config (
  `key` VARCHAR(64) PRIMARY KEY,
  `value` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(32) PRIMARY KEY,
  tokens_left INT NOT NULL,
  tokens_reset_at INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invites (
  code VARCHAR(32) PRIMARY KEY,
  inviter_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  created_at INT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_invites_inviter (inviter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referrals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  inviter_id VARCHAR(32) NOT NULL,
  invite_code VARCHAR(32),
  invitee_id VARCHAR(32) NOT NULL,
  joined_at INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  expires_at INT NULL,
  confirm_started_at INT NULL,
  confirmed_at INT NULL,
  failure_reason VARCHAR(32) NULL,
  suspicious TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_referrals_inviter (inviter_id),
  INDEX idx_referrals_invitee (invitee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rewards_awarded (
  user_id VARCHAR(32) NOT NULL,
  tier INT NOT NULL,
  awarded_at INT NOT NULL,
  PRIMARY KEY (user_id, tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
