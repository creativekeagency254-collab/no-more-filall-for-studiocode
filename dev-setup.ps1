$ErrorActionPreference = 'Stop'

Set-Location -Path $PSScriptRoot

Write-Output '== Install deps =='
npm install

Write-Output '== Key checks =='
npm run test:keys

Write-Output '== Full-stack audit =='
npm run audit:fullstack
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'Full-stack audit failed. This usually means remote DB migrations are missing.'
  Write-Warning 'Localhost will still start so you can continue frontend/login testing.'
}

Write-Output '== Sync role test users =='
npm run force:test-users
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'Could not force-sync test users. Existing users may still work.'
}

Write-Output '== Start localhost =='
npm run dev
