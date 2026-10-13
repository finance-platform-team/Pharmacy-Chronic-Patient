/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CRM_LEAD_URL: string;
  readonly VITE_DATAVERSE_ORG_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
