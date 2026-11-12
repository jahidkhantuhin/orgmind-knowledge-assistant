'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import type { GitHubIntegration, GoogleDriveIntegration } from '@orgmind/shared';
import { IntegrationsManager } from './integrations-manager';
import { GoogleDriveManager } from './google-drive-manager';

type Provider = 'github' | 'google-drive';

export function IntegrationTabs({
  organizationId,
  githubIntegrations,
  driveIntegrations,
}: {
  organizationId: string;
  githubIntegrations: GitHubIntegration[];
  driveIntegrations: GoogleDriveIntegration[];
}) {
  const [activeProvider, setActiveProvider] = useState<Provider>('github');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % 2;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex + 1) % 2;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextProvider: Provider = nextIndex === 0 ? 'github' : 'google-drive';
    setActiveProvider(nextProvider);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="integration-tabs-shell">
      <div className="integration-provider-tabs" role="tablist" aria-label="Integration provider">
        <button
          ref={(element) => {
            tabRefs.current[0] = element;
          }}
          id="github-integration-tab"
          className="integration-provider-tab"
          type="button"
          role="tab"
          aria-selected={activeProvider === 'github'}
          aria-controls="github-integration-panel"
          tabIndex={activeProvider === 'github' ? 0 : -1}
          onClick={() => setActiveProvider('github')}
          onKeyDown={(event) => handleTabKeyDown(event, 0)}
        >
          <span className="integration-provider-tab-mark" aria-hidden="true">
            GH
          </span>
          <span>GitHub</span>
        </button>
        <button
          ref={(element) => {
            tabRefs.current[1] = element;
          }}
          id="google-drive-integration-tab"
          className="integration-provider-tab"
          type="button"
          role="tab"
          aria-selected={activeProvider === 'google-drive'}
          aria-controls="google-drive-integration-panel"
          tabIndex={activeProvider === 'google-drive' ? 0 : -1}
          onClick={() => setActiveProvider('google-drive')}
          onKeyDown={(event) => handleTabKeyDown(event, 1)}
        >
          <span className="integration-provider-tab-mark drive" aria-hidden="true">
            G
          </span>
          <span>Google Drive</span>
        </button>
      </div>

      <section
        id="github-integration-panel"
        className="integration-provider-panel"
        role="tabpanel"
        aria-labelledby="github-integration-tab"
        hidden={activeProvider !== 'github'}
      >
        <div className="integration-providers-grid">
          <IntegrationsManager
            organizationId={organizationId}
            initialIntegrations={githubIntegrations}
          />
        </div>
      </section>

      <section
        id="google-drive-integration-panel"
        className="integration-provider-panel"
        role="tabpanel"
        aria-labelledby="google-drive-integration-tab"
        hidden={activeProvider !== 'google-drive'}
      >
        <div className="integration-providers-grid">
          <GoogleDriveManager
            organizationId={organizationId}
            initialIntegrations={driveIntegrations}
          />
        </div>
      </section>
    </div>
  );
}
