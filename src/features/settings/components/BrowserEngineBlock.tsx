import { ChevronDown, CheckCircle2, Copy, Download, RotateCcw, Globe, FolderOpen } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import type { BrowserEngine } from '../hooks/useBrowserEngine'
import { SOURCE_LABELS } from '../settingsOptions'
import { chromiumBuild } from '../settingsText'
import Block from './Block'
import Row from './Row'
import styles from './BrowserEngineBlock.module.css'

/** The browser engine: the Chromium in use, installing it, and switching to another browser. */
export default function BrowserEngineBlock({ browser, isWeb }: { browser: BrowserEngine; isWeb: boolean })
{
  const {
    browserStatus, browserInstalling, installLog, installLogRef, copiedPath, engineOpen, setEngineOpen,
    copyPath, runBrowserAction, installBrowser, cancelBrowserInstall,
  } = browser
  const build = chromiumBuild(browserStatus?.executablePath)

  return (
    <Block title="Browser engine" anchor="browser" description="The headless browser that reads MediUX and ThePosterDB pages.">
      {browserStatus ? (
        <>
          <Row
            label={browserStatus.installed ? `Chromium${build ? ` ${build}` : ''}` : 'Not installed'}
            description={browserStatus.installed
              ? [browserStatus.source ? SOURCE_LABELS[browserStatus.source] : null, browserStatus.verified ? 'Verified' : 'Not verified yet'].filter(Boolean).join(' · ')
              : 'Install the Chromium headless shell, or use a browser already on this computer.'}
          >
            {!browserStatus.installed && (
              <Button
                variant="primary" size="sm"
                icon={browserInstalling ? <Spinner size="xs" color="current" /> : <Download size={13} />}
                onClick={installBrowser}
                disabled={browserInstalling}
              >
                {browserInstalling ? 'Installing…' : 'Install Chromium'}
              </Button>
            )}
            <Button
              variant="secondary" size="sm"
              icon={<ChevronDown size={13} className={engineOpen ? styles.chevronOpen : undefined} />}
              aria-expanded={engineOpen}
              aria-controls="engine-details"
              onClick={() => setEngineOpen(v => !v)}
            >
              {engineOpen ? 'Hide' : 'Change…'}
            </Button>
          </Row>
          {engineOpen && (
            <div id="engine-details">
              {browserStatus.installed && (
                <Row stacked label="Executable">
                  <div className={styles.pathBox}>
                    <code className={styles.pathText} title={browserStatus.executablePath}>{browserStatus.executablePath || '-'}</code>
                    {browserStatus.executablePath && (
                      <Button
                        variant="ghost" size="sm"
                        icon={copiedPath ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                        aria-label="Copy executable path"
                        onClick={copyPath}
                      />
                    )}
                  </div>
                </Row>
              )}
              <Row stacked label="Use another browser" description="Any Chromium-based browser works. The built-in one is the most reliable.">
                <div className={styles.buttonRow}>
                  {browserStatus.installed && browserStatus.source === 'managed' && (
                    <Button
                      variant="secondary" size="sm"
                      icon={browserInstalling ? <Spinner size="xs" color="current" /> : <RotateCcw size={13} />}
                      onClick={installBrowser}
                      disabled={browserInstalling}
                    >
                      {browserInstalling ? 'Installing…' : 'Reinstall'}
                    </Button>
                  )}
                  {(browserStatus.source === 'system' || browserStatus.source === 'custom') && (
                    <Button variant="secondary" size="sm" onClick={() => void runBrowserAction(() => window.api.browser.useExecutable(null))} disabled={browserInstalling}>
                      Use the built-in browser
                    </Button>
                  )}
                  {browserStatus.systemBrowsers
                    .filter(browser => browser.path !== browserStatus.executablePath)
                    .map(browser => (
                      <Button
                        key={browser.path}
                        variant="secondary" size="sm"
                        icon={<Globe size={13} />}
                        onClick={() => void runBrowserAction(() => window.api.browser.useExecutable(browser.path))}
                        disabled={browserInstalling}
                        title={browser.path}
                      >
                        Use {browser.name}
                      </Button>
                    ))}
                  {!isWeb && (
                    <Button
                      variant="secondary" size="sm"
                      icon={<FolderOpen size={13} />}
                      onClick={() => void runBrowserAction(() => window.api.browser.pickExecutable())}
                      disabled={browserInstalling}
                    >
                      Browse…
                    </Button>
                  )}
                  {browserInstalling && (
                    <Button variant="ghost" size="sm" onClick={() => void cancelBrowserInstall()}>Cancel</Button>
                  )}
                </div>
                {installLog.length > 0 && (
                  <div className={styles.installLog} ref={installLogRef} role="log" aria-live="polite">
                    {installLog.map((line, i) => (
                      <div key={i} className={styles.installLogLine}>{line}</div>
                    ))}
                  </div>
                )}
              </Row>
            </div>
          )}
        </>
      ) : (
        <Row label="Checking the browser engine…"><Spinner size="sm" /></Row>
      )}
    </Block>
  )
}
