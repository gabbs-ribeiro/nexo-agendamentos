#!/usr/bin/env bash
# =====================================================================
# Teste de concorrencia de ponta a ponta (API publica do Supabase DEV)
# Dispara N requisicoes SIMULTANEAS para create_public_booking, como o
# navegador de varios clientes faria, e confere que o banco aceita so o certo.
#
# Pre-requisitos: bash, curl, GNU date (Linux, WSL ou Git Bash). Nao precisa de jq.
# Preparacao: rodar tests/05_concurrency_setup.sql no projeto de DEV.
#
# Uso (NUNCA aponte para producao; NUNCA commite a chave):
#   export SUPABASE_URL="https://SEU-PROJETO-DEV.supabase.co"
#   export SUPABASE_ANON_KEY="<chave anon/publishable do projeto DEV>"
#   N=30 bash supabase/tests/concurrency_test.sh
#
# Para repetir o teste, rode antes 07_concurrency_cleanup.sql (senao os horarios ja estarao ocupados).
#
# Cenarios (cada um em um dia diferente, para nao interferirem):
#   1) N clientes disputam o MESMO horario            -> exatamente 1 sucesso
#   2) N requisicoes com a MESMA chave de idempotencia -> mesma reserva para todas, 1 linha no banco
#   3) N clientes disputam horarios que se CONFLITAM
#      (10:00 e 10:30, servico de 45 min + gap de 10)  -> exatamente 1 sucesso
# =====================================================================
set -u

: "${SUPABASE_URL:?defina SUPABASE_URL (projeto de DEV)}"
: "${SUPABASE_ANON_KEY:?defina SUPABASE_ANON_KEY (chave anon do DEV)}"
SLUG="${SLUG:-loja-concorrencia}"
OPTION_ID="${OPTION_ID:-c0000000-0000-0000-0000-0000000000c3}"
N="${N:-30}"
TZ_OFFSET="${TZ_OFFSET:--03:00}"   # America/Sao_Paulo (sem horario de verao)

FAILS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

newuuid() {
  # 1) Linux  2) uuidgen  3) /dev/urandom + od (funciona no Git Bash do Windows)
  if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid; return; fi
  if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'; return; fi
  local h v
  h=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
  v=$(( (0x${h:16:1} & 3) | 8 ))   # variante RFC 4122: 8, 9, a ou b
  printf '%s-%s-4%s-%x%s-%s\n' "${h:0:8}" "${h:8:4}" "${h:13:3}" "$v" "${h:17:3}" "${h:20:12}"
}

_probe="$(newuuid)"
case "$_probe" in
  ????????-????-4???-[89ab]???-????????????) ;;
  *) echo "ERRO: nao consegui gerar UUID neste terminal (got: '$_probe')."; exit 2 ;;
esac

day_plus() { date -u -d "+$1 days" +%Y-%m-%d; }

# call_booking <start_iso> <phone> <idempotency_key> <outfile>
call_booking() {
  curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/create_public_booking" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"p_slug\":\"$SLUG\",\"p_option_id\":\"$OPTION_ID\",\"p_starts_at\":\"$1\",\"p_customer_name\":\"Teste Concorrencia\",\"p_customer_phone\":\"$2\",\"p_pet_name\":\"Rex\",\"p_pet_breed\":null,\"p_notes\":null,\"p_consent\":true,\"p_idempotency_key\":\"$3\"}" \
    > "$4" 2>&1
}

count_matching() { # <dir> <regex>
  grep -l -E "$2" "$1"/* 2>/dev/null | wc -l | tr -d ' '
}

report() { # <dir> <expected_ok> <label>
  local dir="$1" expected_ok="$2" label="$3"
  local ok slot other
  ok=$(count_matching "$dir" '"ok": *true')
  slot=$(count_matching "$dir" 'SLOT_UNAVAILABLE')
  other=$((N - ok - slot))
  echo "  sucessos=$ok  SLOT_UNAVAILABLE=$slot  outros=$other  (esperado sucessos=$expected_ok)"
  if [ "$ok" -ne "$expected_ok" ] || [ "$other" -ne 0 ]; then
    echo "  >>> FALHOU: $label"
    echo "  Amostra de respostas inesperadas:"
    grep -L -E '"ok": *true|SLOT_UNAVAILABLE' "$dir"/* 2>/dev/null | head -3 | xargs -r -I{} sh -c 'echo "    $(cat {})"'
    FAILS=$((FAILS + 1))
  else
    echo "  OK: $label"
  fi
}

echo "== Cenario 1: $N clientes, MESMO horario =="
D1="$(day_plus 5)"
DIR1="$TMP_ROOT/c1"; mkdir -p "$DIR1"
for i in $(seq 1 "$N"); do
  call_booking "${D1}T10:00:00${TZ_OFFSET}" "$(printf '4191%07d' "$i")" "$(newuuid)" "$DIR1/$i.json" &
done
wait
report "$DIR1" 1 "apenas 1 reserva aceita para o mesmo horario"

echo "== Cenario 2: $N requisicoes, MESMA chave de idempotencia =="
D2="$(day_plus 6)"
KEY="$(newuuid)"
DIR2="$TMP_ROOT/c2"; mkdir -p "$DIR2"
for i in $(seq 1 "$N"); do
  call_booking "${D2}T09:00:00${TZ_OFFSET}" "41920000001" "$KEY" "$DIR2/$i.json" &
done
wait
OK2=$(count_matching "$DIR2" '"ok": *true')
REFS=$(cat "$DIR2"/* | grep -o '"booking_ref": *"[0-9a-f-]*"' | sort -u | wc -l | tr -d ' ')
echo "  sucessos=$OK2 de $N  |  booking_ref distintos=$REFS (esperado: todos ok e 1 ref)"
if [ "$OK2" -ne "$N" ] || [ "$REFS" -ne 1 ]; then
  echo "  >>> FALHOU: idempotencia sob concorrencia"; FAILS=$((FAILS + 1))
else
  echo "  OK: retry/duplo clique concorrente gerou uma unica reserva"
fi

echo "== Cenario 3: $N clientes, horarios que se CONFLITAM (10:00 e 10:30) =="
D3="$(day_plus 7)"
DIR3="$TMP_ROOT/c3"; mkdir -p "$DIR3"
for i in $(seq 1 "$N"); do
  if [ $((i % 2)) -eq 0 ]; then H="10:00"; else H="10:30"; fi
  call_booking "${D3}T${H}:00${TZ_OFFSET}" "$(printf '4193%07d' "$i")" "$(newuuid)" "$DIR3/$i.json" &
done
wait
report "$DIR3" 1 "apenas 1 reserva entre horarios conflitantes"

echo
if [ "$FAILS" -eq 0 ]; then
  echo "RESULTADO: todos os cenarios passaram."
else
  echo "RESULTADO: $FAILS cenario(s) FALHARAM. Nao libere o sistema."
fi
echo "Agora rode tests/06_concurrency_verify.sql no SQL Editor (confere o banco) e depois 07_concurrency_cleanup.sql."
echo "Se TODOS os sucessos forem 0 e as respostas forem SLOT_UNAVAILABLE, o dia/horario do teste pode estar invalido: rode o setup e confira o fuso."
[ "$FAILS" -eq 0 ]
