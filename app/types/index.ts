export interface Profile {
  id: string;
  name: string;
  title: string;
  company: string;
  linkedinUrl: string;
  summary: string;
  inHubSpot?: boolean;
  hubSpotContactId?: string;
}
