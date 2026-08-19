export interface SystemStateRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface MemberRow {
  id: string;
  full_name: string;
  normalized_name: string;
  bank_display_name: string;
  disambiguator?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type NameCorrectionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface NameCorrectionRequestRow {
  id: string;
  member_id: string;
  current_name: string;
  requested_name: string;
  notes?: string | null;
  status: NameCorrectionStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export type ExternalContributorStatus =
  | 'PENDING_REVIEW'
  | 'NORMALIZED'
  | 'LINKED_TO_MEMBER'
  | 'CONFIRMED_EXTERNAL';

export interface ExternalContributorRow {
  id: string;
  raw_name: string;
  normalized_name: string;
  display_name: string;
  status: ExternalContributorStatus;
  linked_member_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentIntentStatus = 'PENDING' | 'COMPLETED' | 'EXPIRED';

export interface PaymentIntentRow {
  id: string;
  payment_code: string;
  member_id?: string | null;
  external_contributor_id?: string | null;
  expected_amount: number;
  transfer_content: string;
  status: PaymentIntentStatus;
  expires_at?: string | null;
  created_at: string;
}

export type TransferType = 'in' | 'out';
export type IngestionSource = 'WEBHOOK' | 'RECONCILIATION' | 'MANUAL_IMPORT';

export interface BankTransactionRow {
  id: string;
  sepay_id: number;
  gateway: string;
  transaction_date: string;
  account_number: string;
  sub_account?: string | null;
  transfer_type: TransferType;
  transfer_amount: number;
  accumulated?: number | null;
  code?: string | null;
  content: string;
  description?: string | null;
  reference_code?: string | null;
  raw_payload: string;
  ingestion_source: IngestionSource;
  is_excluded: number;
  exclusion_reason?: string | null;
  excluded_by?: string | null;
  created_at: string;
}

export type ContributorType = 'MEMBER' | 'EXTERNAL' | 'UNRESOLVED';
export type MatchMethod =
  | 'EXACT_PAYMENT_CODE'
  | 'DETERMINISTIC_NAME_FALLBACK'
  | 'MANUAL_TREASURER_ASSIGNMENT'
  | 'UNRESOLVED';

export interface ContributionRow {
  id: string;
  bank_transaction_id: string;
  payment_intent_id?: string | null;
  contributor_type: ContributorType;
  member_id?: string | null;
  external_contributor_id?: string | null;
  unresolved_name?: string | null;
  amount: number;
  is_amount_mismatch: number;
  match_method: MatchMethod;
  reviewed_by?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type ExpenseCategory =
  | 'FOOD'
  | 'GIFT_TEACHER'
  | 'FLOWERS'
  | 'PHOTO_VIDEO'
  | 'PRINTING'
  | 'TRANSPORT'
  | 'REFUND'
  | 'FUND_TRANSFER'
  | 'OTHER'
  | 'UNKNOWN';

export type ClassificationSource =
  | 'MANUAL_OVERRIDE'
  | 'LEARNED_RULE'
  | 'DETERMINISTIC_RULE'
  | 'GEMINI_AI'
  | 'MOCK_AI'
  | 'UNKNOWN';

export interface ExpenseRow {
  id: string;
  bank_transaction_id: string;
  title?: string | null;
  vietnamese_title?: string | null;
  category: ExpenseCategory;
  recipient_name?: string | null;
  recipient_account?: string | null;
  recipient_bank?: string | null;
  amount: number;
  classification_source: ClassificationSource;
  ai_confidence?: number | null;
  is_settlement_transfer: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassificationRuleRow {
  id: string;
  recipient_pattern: string;
  assigned_category: ExpenseCategory;
  suggested_title?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface AttachmentRow {
  id: string;
  expense_id: string;
  file_name: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  sha256_hash: string;
  storage_path: string;
  storage_provider?: string;
  storage_key?: string | null;
  uploaded_by?: string | null;
  created_at: string;
}

export type UserRole = 'ADMIN' | 'MEMBER';
export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED';

export interface UserRow {
  id: string;
  member_id?: string | null;
  username: string;
  email?: string | null;
  password_hash: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  email_verified: number;
  created_at: string;
  updated_at: string;
}

export interface EmailVerificationRow {
  id: string;
  user_id: string;
  email: string;
  token: string;
  code: string;
  expires_at: string;
  used_at?: string | null;
  created_at: string;
}

export interface StaffUserRow {
  id: string;
  username: string;
  password_hash: string;
  full_name: string;
  member_id?: string | null;
  role: 'ADMIN' | 'TREASURER';
  created_at: string;
}

export interface ActivityRow {
  id: string;
  title: string;
  description?: string | null;
  display_order: number;
  created_at: string;
}

export interface ActivityRSVPRow {
  id: string;
  activity_id: string;
  member_id: string;
  user_id: string;
  participant_count: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityPublicParticipant {
  member_id: string;
  full_name: string;
  disambiguator?: string | null;
  participant_count: number;
  updated_at: string;
}

export interface ActivityPublicSummary {
  id: string;
  title: string;
  description?: string | null;
  display_order: number;
  total_participants: number;
  participants: ActivityPublicParticipant[];
}


export interface AuditLogRow {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_state?: string | null;
  after_state?: string | null;
  ip_address?: string | null;
  timestamp: string;
}

export interface ReconciliationRunRow {
  id: string;
  started_at: string;
  completed_at?: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  total_checked: number;
  already_present: number;
  newly_imported: number;
  error_count: number;
  log_summary?: string | null;
  triggered_by: 'CRON' | 'STARTUP' | 'MANUAL';
}
