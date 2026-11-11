import { expect, it } from 'vitest'
import { defaultHelm, helmCommands, powershellQuote, shellQuote } from './helm'
it('POSIX quote protects shell expansion, apostrophes and newlines', () => {
  expect(shellQuote("a'b;$HOME`whoami`\n")).toBe("'a'\\''b;$HOME`whoami`\n'")
})
it('PowerShell quote doubles apostrophes and keeps metacharacters literal', () => {
  const val = "a'b;$(Get-Item x)`n\n"
  expect(powershellQuote(val)).toBe("'a''b;$(Get-Item x)`n\n'")
  const win = helmCommands({ ...defaultHelm, repoName: val, repoUrl: val, chart: val }).find(c => c.id === 'windows')!.command
  expect(win).toContain(`helm repo add ${powershellQuote(val)} ${powershellQuote(val)}`)
  expect(win).toContain(`helm template my-release ${powershellQuote(val)}`)
})
