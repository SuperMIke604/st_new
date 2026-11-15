param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$SdkRoot = $env:ANDROID_HOME,
    [string]$Platform = 'android-34',
    [string]$BuildTools = '34.0.0'
)

$ErrorActionPreference = 'Stop'
if (!$SdkRoot) { $SdkRoot = $env:ANDROID_SDK_ROOT }
if (!$JavaHome -or !$SdkRoot) {
    throw 'Set JAVA_HOME and ANDROID_HOME or pass -JavaHome and -SdkRoot.'
}

$javaBin = Join-Path (Resolve-Path -LiteralPath $JavaHome).Path 'bin'
$sdk = (Resolve-Path -LiteralPath $SdkRoot).Path
$toolsDir = Join-Path $sdk "build-tools/$BuildTools"
$androidJar = Join-Path $sdk "platforms/$Platform/android.jar"
$java = Join-Path $javaBin 'java.exe'
$javac = Join-Path $javaBin 'javac.exe'
$jar = Join-Path $javaBin 'jar.exe'
$keytool = Join-Path $javaBin 'keytool.exe'
$aapt = Join-Path $toolsDir 'aapt2.exe'
$d8 = Join-Path $toolsDir 'lib/d8.jar'
$zipalign = Join-Path $toolsDir 'zipalign.exe'
$apksigner = Join-Path $toolsDir 'lib/apksigner.jar'
foreach ($path in @($androidJar, $java, $javac, $jar, $keytool, $aapt, $d8, $zipalign, $apksigner)) {
    if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing build tool or SDK file: $path" }
}

function Invoke-BuildTool {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with code $LASTEXITCODE" }
}

$output = Join-Path $PSScriptRoot 'build'
$scratch = Join-Path $output ([guid]::NewGuid().ToString('N'))
$classes = Join-Path $scratch 'classes'
$dex = Join-Path $scratch 'dex'
New-Item -ItemType Directory -Path $classes, $dex | Out-Null

Push-Location -LiteralPath $PSScriptRoot
try {
    # Android's native Windows tools can fail on absolute paths with non-ASCII characters.
    $relativeScratch = Resolve-Path -LiteralPath $scratch -Relative
    $relativeAndroidJar = Resolve-Path -LiteralPath $androidJar -Relative
    $res = Join-Path $relativeScratch 'resources.zip'
    $unsigned = Join-Path $relativeScratch 'unsigned.apk'
    $aligned = Join-Path $relativeScratch 'aligned.apk'
    $signed = Join-Path $relativeScratch 'st-new.apk'
    $compiled = Join-Path $relativeScratch 'classes.jar'
    $signingKey = Join-Path $output 'debug.keystore'

    Invoke-BuildTool $aapt @('compile', '--dir', 'res', '-o', $res)
    Invoke-BuildTool $aapt @('link', '-I', $relativeAndroidJar, '--manifest', 'AndroidManifest.xml',
        '-A', 'assets', '-o', $unsigned, $res)
    $sources = @(Get-ChildItem -Path src -Recurse -File -Filter '*.java' |
        ForEach-Object { Resolve-Path -LiteralPath $_.FullName -Relative })
    Invoke-BuildTool $javac (@('--release', '8', '-encoding', 'UTF-8', '-classpath', $androidJar,
        '-d', $classes) + $sources)
    Invoke-BuildTool $jar @('cf', $compiled, '-C', $classes, '.')
    Invoke-BuildTool $java @('-cp', $d8, 'com.android.tools.r8.D8', '--release', '--min-api', '24',
        '--lib', $androidJar, '--output', $dex, $compiled)
    Invoke-BuildTool $jar @('uf', $unsigned, '-C', $dex, 'classes.dex')
    Invoke-BuildTool $zipalign @('-f', '4', $unsigned, $aligned)

    if (!(Test-Path -LiteralPath $signingKey)) {
        Invoke-BuildTool $keytool @('-genkeypair', '-keystore', $signingKey, '-storepass', 'android',
            '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048',
            '-validity', '10000', '-dname', 'CN=Android Debug,O=Android,C=US')
    }
    Invoke-BuildTool $java @('-jar', $apksigner, 'sign', '--ks', $signingKey, '--ks-pass', 'pass:android',
        '--key-pass', 'pass:android', '--out', $signed, $aligned)
    Invoke-BuildTool $java @('-jar', $apksigner, 'verify', '--verbose', $signed)
    $apk = Join-Path $output 'st-new.apk'
    Move-Item -LiteralPath $signed -Destination $apk -Force
    Get-Item -LiteralPath $apk
} finally {
    Pop-Location
    $resolvedScratch = (Resolve-Path -LiteralPath $scratch).Path
    $resolvedOutput = (Resolve-Path -LiteralPath $output).Path
    if ([IO.Path]::GetDirectoryName($resolvedScratch) -eq $resolvedOutput) {
        Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
    }
}
