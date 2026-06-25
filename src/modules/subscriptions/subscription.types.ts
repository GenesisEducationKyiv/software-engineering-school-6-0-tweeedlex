export interface SubscriptionResponse {
  email: string;
  repo: string;
  confirmed: boolean;
  last_seen_tag: string | null;
}
