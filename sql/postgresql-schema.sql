CREATE TABLE users (
  id uuid PRIMARY KEY,
  username varchar(64) NOT NULL UNIQUE,
  password varchar(255) NOT NULL,
  name varchar(128) NOT NULL,
  role varchar(32) NOT NULL,
  person_id uuid NULL,
  sso_subject varchar(128) NULL,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE TABLE people (
  id uuid PRIMARY KEY,
  employee_no varchar(64) NOT NULL,
  name varchar(128) NOT NULL,
  department varchar(128) NOT NULL,
  position varchar(128) NOT NULL,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE TABLE frameworks (
  id uuid PRIMARY KEY,
  name varchar(128) NOT NULL,
  score_options_json jsonb NOT NULL,
  weight_options_json jsonb NOT NULL,
  created_at timestamp NOT NULL
);

CREATE TABLE framework_levels (
  id uuid PRIMARY KEY,
  framework_id uuid NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  name varchar(64) NOT NULL,
  display_order integer NOT NULL,
  min_rate numeric(6,4) NOT NULL,
  max_rate numeric(6,4) NOT NULL,
  key_rule_enabled boolean NOT NULL DEFAULT false,
  min_key_rate numeric(6,4),
  disallow_zero_key_score boolean NOT NULL DEFAULT false
);

CREATE TABLE framework_dimensions (
  id uuid PRIMARY KEY,
  framework_id uuid NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  name varchar(128) NOT NULL,
  display_order integer NOT NULL
);

CREATE TABLE framework_categories (
  id uuid PRIMARY KEY,
  dimension_id uuid NOT NULL REFERENCES framework_dimensions(id) ON DELETE CASCADE,
  name varchar(128) NOT NULL,
  display_order integer NOT NULL
);

CREATE TABLE framework_score_items (
  id uuid PRIMARY KEY,
  category_id uuid NOT NULL REFERENCES framework_categories(id) ON DELETE CASCADE,
  title varchar(255) NOT NULL,
  description text NOT NULL,
  weight numeric(4,2) NOT NULL,
  is_key_item boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL
);

CREATE TABLE evaluation_cycles (
  id uuid PRIMARY KEY,
  name varchar(128) NOT NULL,
  status varchar(32) NOT NULL,
  framework_id uuid NOT NULL REFERENCES frameworks(id),
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE TABLE evaluations (
  id uuid PRIMARY KEY,
  cycle_id uuid NOT NULL REFERENCES evaluation_cycles(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  reviewer_id uuid NULL,
  status varchar(32) NOT NULL,
  raw_score numeric(10,2) NOT NULL DEFAULT 0,
  weighted_score numeric(10,2) NOT NULL DEFAULT 0,
  weighted_max_score numeric(10,2) NOT NULL DEFAULT 0,
  score_rate numeric(6,4) NOT NULL DEFAULT 0,
  key_score_rate numeric(6,4),
  has_zero_key_score boolean NOT NULL DEFAULT false,
  level_id uuid NULL,
  level_name varchar(64),
  submitted_at timestamp NULL,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL,
  UNIQUE (cycle_id, person_id)
);

CREATE TABLE evaluation_scores (
  id uuid PRIMARY KEY,
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  score_item_id uuid NOT NULL REFERENCES framework_score_items(id) ON DELETE CASCADE,
  score_value numeric(10,2) NOT NULL,
  weighted_score numeric(10,2) NOT NULL,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL,
  UNIQUE (evaluation_id, score_item_id)
);

CREATE TABLE review_submissions (
  id uuid PRIMARY KEY,
  cycle_id uuid NOT NULL REFERENCES evaluation_cycles(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_type varchar(32) NOT NULL,
  status varchar(32) NOT NULL,
  comments text NOT NULL DEFAULT '',
  raw_score numeric(10,2) NOT NULL DEFAULT 0,
  weighted_score numeric(10,2) NOT NULL DEFAULT 0,
  weighted_max_score numeric(10,2) NOT NULL DEFAULT 0,
  score_rate numeric(6,4) NOT NULL DEFAULT 0,
  key_score_rate numeric(6,4),
  level_id uuid NULL,
  level_name varchar(64),
  submitted_at timestamp NULL,
  approved_at timestamp NULL,
  rejected_at timestamp NULL,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL,
  UNIQUE (cycle_id, person_id, reviewer_id, review_type)
);

CREATE TABLE review_submission_scores (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES review_submissions(id) ON DELETE CASCADE,
  score_item_id uuid NOT NULL REFERENCES framework_score_items(id) ON DELETE CASCADE,
  score_value numeric(10,2) NOT NULL,
  weighted_score numeric(10,2) NOT NULL,
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL,
  UNIQUE (submission_id, score_item_id)
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  actor_user_id uuid NULL,
  action varchar(128) NOT NULL,
  entity_type varchar(64) NOT NULL,
  entity_id varchar(128) NOT NULL,
  details_json jsonb NOT NULL,
  created_at timestamp NOT NULL
);

CREATE TABLE framework_templates (
  id uuid PRIMARY KEY,
  name varchar(128) NOT NULL UNIQUE,
  description text NOT NULL,
  framework_json jsonb NOT NULL,
  created_at timestamp NOT NULL
);
