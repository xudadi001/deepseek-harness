/** The pinned builder template keeps its registration flow around staged directory replacement. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { directoryInstallerExits, directoryInstallSection, directoryUninstaller } from '../scripts/windows-directory-installer.mjs'

const require = createRequire(import.meta.url)
const section = readFileSync(join(dirname(require.resolve('app-builder-lib/package.json')),
  'templates/nsis/installSection.nsh'), 'utf8')

it('keeps data cleanup out of the upstream template while retaining application removal and registration cleanup', () => {
  const source = readFileSync(join(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/uninstaller.nsh'), 'utf8')
  const adapted = directoryUninstaller(source)
  expect(adapted).not.toContain('--delete-app-data')
  expect(adapted).not.toContain('RMDir /r "$APPDATA')
  expect(adapted).toContain('!insertmacro customUnInstall')
  expect(adapted).toContain('DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"')
  expect(adapted).toContain('DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}"')
  expect(directoryUninstaller(source.replaceAll('\n', '\r\n'))).toBe(adapted)
  expect(adapted).toContain('RMDir /r "\\\\?\\$INSTDIR"')
  expect(() => directoryUninstaller(source.replace('  Var /GLOBAL isDeleteAppData\n', ''))).toThrow('template changed')
  expect(() => directoryUninstaller(source.replace('  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"', ''))).toThrow('template changed')
})

it.each(['allowOnlyOneInstallerInstance.nsh', 'installUtil.nsh'])('cleans staged files before %s exits', (helper) => {
  const source = readFileSync(join(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/include', helper), 'utf8')
  const exits = source.match(/^\s*Quit\s*$/gm) ?? []
  expect(exits.length).toBeGreaterThan(0)
  const adapted = directoryInstallerExits(source)
  expect(adapted.match(/Call dshCleanupDirectories/g)).toHaveLength(exits.length)
  expect(adapted).toContain('!ifndef BUILD_UNINSTALLER')
})

it('stages before stopping the application and promotes before registering the installation', () => {
  const result = directoryInstallSection(section)
  expect(result.indexOf('!insertmacro dshStageApplication')).toBeLessThan(result.indexOf('!insertmacro CHECK_APP_RUNNING'))
  expect(result.indexOf('Call dshPromoteDirectories')).toBeLessThan(result.indexOf('!insertmacro registryAddInstallInfo'))
  expect(result).toContain('!insertmacro addStartMenuLink $keepShortcuts')
  expect(result).toContain('!insertmacro addDesktopLink $keepShortcuts')
  expect(result).toContain('!insertmacro handleUninstallResult HKEY_CURRENT_USER')
  expect(result).not.toContain('!insertmacro installApplicationFiles')
  expect(result).not.toContain('File /oname=uninstallerIcon.ico')
})

it.each(['!include installer.nsh', '!insertmacro setLinkVars', '!insertmacro installApplicationFiles'])(
  'rejects a missing or duplicate upstream insertion point: %s', (point) => {
    expect(() => directoryInstallSection(section.replace(point, ''))).toThrow('Desktop NSIS template changed')
    expect(() => directoryInstallSection(`${section}\n${point}`)).toThrow('Desktop NSIS template changed')
  },
)

it('offers an interactive retry for directory locks without weakening silent rollback', () => {
  const script = readFileSync(join(import.meta.dirname, '../scripts/installer-directories.nsh'), 'utf8')
  expect(script).toContain('!macro dshDirectoryOperationWithRetry SOURCE DESTINATION RESULT PHASE')
  const retry = script.split('!macro dshDirectoryOperationWithRetry SOURCE DESTINATION RESULT PHASE')[1]
    ?.split('!macroend')[0]
  expect(retry).toBeDefined()
  expect(retry).toContain('!insertmacro dshDirectoryOperation "${SOURCE}" "${DESTINATION}" ${RESULT} "${PHASE}"')
  expect(retry).toContain('${If} ${Silent}')
  for (const error of [5, 32, 33]) expect(retry).toContain('${RESULT} != ' + error)
  expect(retry).toContain('MessageBox MB_RETRYCANCEL')
  expect(retry).toContain('$(INSTALLER_DIRECTORY_RETRY)')
  // The transaction also retries restoration; cancellation still reports the real Win32 error.
  expect(script.match(/!insertmacro dshDirectoryOperationWithRetry "/g)).toHaveLength(4)
  expect(script).toContain('Call dshRollbackDirectories')
  expect(script).toContain('StrCpy $dshRecoveryStopped "1"')
})
