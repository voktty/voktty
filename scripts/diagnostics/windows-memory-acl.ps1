$ErrorActionPreference = 'Stop'

$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$trustedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
try {
    $installer = [Security.Principal.NTAccount]::new('NT SERVICE', 'TrustedInstaller')
    $trustedAncestorSids = @($trustedSids) + $installer.Translate([Security.Principal.SecurityIdentifier]).Value
} catch {
    $trustedAncestorSids = @($trustedSids)
    Write-Output 'memory-acl: installer classification unavailable'
}

$application = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'app.voktty.voktty'
try {
    $supported = [IO.Path]::IsPathFullyQualified($application) -and
        -not $application.StartsWith('\\') -and
        -not $application.StartsWith('//') -and
        $application.Length -le 4096 -and
        [IO.DriveInfo]::new([IO.Path]::GetPathRoot($application)).DriveType -eq [IO.DriveType]::Fixed
} catch {
    $supported = $false
}
if (-not $supported) {
    Write-Output 'memory-acl: unsupported native origin'
    return
}
$privateDirectory = Join-Path $application 'project-memory'
$chain = [Collections.Generic.List[string]]::new()
$candidate = $privateDirectory
while ($candidate -and $chain.Count -lt 128) {
    $chain.Add($candidate)
    $candidate = Split-Path -LiteralPath $candidate
}
$chain.Reverse()
$destructive = 0x00010000 -bor 0x00000040 -bor 0x00000100 -bor 0x00000010 -bor 0x00040000 -bor 0x00080000 -bor 0x10000000 -bor 0x40000000

for ($depth = 0; $depth -lt $chain.Count; $depth++) {
    $candidate = $chain[$depth]
    $scope = if ($candidate -eq $privateDirectory) { 'private' } elseif ($candidate -eq $application) { 'application' } else { 'ancestor' }
    try {
        $attributes = [IO.File]::GetAttributes($candidate)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Write-Output "memory-acl: depth=$depth scope=$scope reparse-point"
            break
        }
        if (($attributes -band [IO.FileAttributes]::Directory) -eq 0) {
            Write-Output "memory-acl: depth=$depth scope=$scope not-directory"
            break
        }
        $security = Get-Acl -LiteralPath $candidate
        $owner = $security.GetOwner([Security.Principal.SecurityIdentifier]).Value
        $allowed = if ($scope -eq 'ancestor') { $trustedAncestorSids } else { $trustedSids }
        $ownerCurrent = $owner -eq $currentSid
        $ownerTrusted = $allowed -contains $owner
        Write-Output "memory-acl: depth=$depth scope=$scope ownerCurrent=$ownerCurrent ownerTrusted=$ownerTrusted"
        $rules = $security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
        $count = 0
        foreach ($rule in $rules) {
            if (++$count -gt 256) {
                Write-Output "memory-acl: depth=$depth scope=$scope rule-limit"
                break
            }
            if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
                ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0 -or
                $allowed -contains $rule.IdentityReference.Value) {
                continue
            }
            $mask = [int64]$rule.FileSystemRights
            $rejected = if ($scope -eq 'private') { $mask -ne 0 } else { ($mask -band $destructive) -ne 0 }
            if ($rejected) {
                $principal = switch ($rule.IdentityReference.Value) {
                    'S-1-3-0' { 'creator-owner' }
                    'S-1-3-4' { 'owner-rights' }
                    'S-1-5-32-545' { 'users' }
                    'S-1-5-11' { 'authenticated-users' }
                    'S-1-1-0' { 'everyone' }
                    default { 'other' }
                }
                Write-Output ('memory-acl: depth={0} scope={1} principal={2} untrustedGrantMask=0x{3:X8}' -f $depth, $scope, $principal, ($mask -band 0xFFFFFFFFL))
            }
        }
    } catch {
        Write-Output "memory-acl: depth=$depth scope=$scope unavailable"
        break
    }
}
