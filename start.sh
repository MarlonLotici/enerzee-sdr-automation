#!/bin/bash

# Encontra o Python instalado pelo Nix
export PYTHON_BIN=$(which python3.11 || which python3 || which python)

if [ -z "$PYTHON_BIN" ]; then
    echo "❌ ERRO: Python não encontrado!"
    exit 1
fi

echo "✅ Python encontrado: $PYTHON_BIN"

# Instala edge-tts se necessário
$PYTHON_BIN -m pip show edge-tts > /dev/null 2>&1 || {
    echo "📦 Instalando edge-tts..."
    $PYTHON_BIN -m pip install --user edge-tts
}

# Adiciona o diretório de binários Python ao PATH
export PATH="$PATH:$HOME/.local/bin"

# Inicia o servidor Node.js
exec node server.js