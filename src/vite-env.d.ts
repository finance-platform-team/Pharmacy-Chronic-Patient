/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATAVERSE_ORG_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
