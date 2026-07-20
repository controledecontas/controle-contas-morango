# Exporta todo o Supabase (nota, item, produto_sugestao + fotos) pra pasta backup/.
# Rodar depois do "Restore" no dashboard.

$SUPABASE_URL = "https://dqsxyjaehwpsixqqehby.supabase.co"
$SUPABASE_KEY = "sb_publishable_4fidDEq0sAxdrr8COnsSpg_bWC42SGk"
$OUT = $PSScriptRoot
$FOTOS_DIR = Join-Path $OUT "notas"
if (-not (Test-Path $FOTOS_DIR)) { New-Item -ItemType Directory -Path $FOTOS_DIR | Out-Null }

$h = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $SUPABASE_KEY" }

function DumpTable([string]$table) {
    $all = @()
    $limit = 1000
    $offset = 0
    while ($true) {
        $url = "$SUPABASE_URL/rest/v1/$table" + "?select=*&limit=$limit&offset=$offset&order=created_at.asc"
        Write-Host "GET $table offset=$offset ..."
        $r = Invoke-RestMethod -Uri $url -Headers $h -Method GET
        if (-not $r -or $r.Count -eq 0) { break }
        $all += $r
        if ($r.Count -lt $limit) { break }
        $offset += $limit
    }
    $file = Join-Path $OUT "$table.json"
    $all | ConvertTo-Json -Depth 10 | Out-File -FilePath $file -Encoding utf8
    Write-Host "  -> $($all.Count) linhas em $file"
    return $all
}

Write-Host "==> Exportando tabelas"
$notas = DumpTable "nota"
$itens = DumpTable "item"
$sug = DumpTable "produto_sugestao"

Write-Host "==> Baixando fotos do bucket 'notas'"
$paths = $notas | Where-Object { $_.anexo_path } | Select-Object -ExpandProperty anexo_path
Write-Host "  $($paths.Count) fotos referenciadas"

foreach ($p in $paths) {
    $signUrl = "$SUPABASE_URL/storage/v1/object/sign/notas/$p"
    try {
        $signed = Invoke-RestMethod -Uri $signUrl -Headers $h -Method POST -Body '{"expiresIn":300}' -ContentType "application/json"
        $fileUrl = "$SUPABASE_URL/storage/v1$($signed.signedURL)"
        $dest = Join-Path $FOTOS_DIR $p
        $destDir = Split-Path $dest -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        Invoke-WebRequest -Uri $fileUrl -Headers $h -OutFile $dest -UseBasicParsing
        Write-Host "  ok: $p"
    } catch {
        Write-Host "  FALHA: $p -> $($_.Exception.Message)"
    }
}

Write-Host ""
Write-Host "DONE. Arquivos em: $OUT"
