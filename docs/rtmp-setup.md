# Configuração RTMP no App Mibo Smart

Guia para configurar câmeras da linha iM para enviar stream RTMP ao servidor Flac Guard.

## Pré-requisitos

- Câmera iM3 C, iM5 SC ou iMX
- App **Mibo Smart** instalado no celular
- Câmera já configurada e conectada ao Wi-Fi do PDV
- Stream key gerada pela API (`POST /api/cameras`)

## Passo a passo

1. Abra o app **Mibo Smart**
2. Selecione a câmera desejada
3. Acesse **Configurações** (ícone de engrenagem)
4. Vá em **Mais** → **Redes** → **RTMP**
5. **Habilitar**: ative o RTMP
6. Selecione **Personalizado**
7. Preencha os campos:
   - **Stream**: Econômica (recomendado para reduzir bandwidth) ou Principal
   - **Endereço**: IP ou domínio do servidor (ex: `guard.flac.com.br`)
   - **Porta**: `1935`
   - **URL RTMP**: `/live/{STREAM_KEY}`
8. Salve e confirme

## Validação

Após configurar, verifique no dashboard:
- A câmera deve aparecer como **online** em poucos segundos
- O stream HLS deve estar acessível em `/hls/{STREAM_KEY}.m3u8`

## Resolução de problemas

| Problema | Solução |
|----------|---------|
| Câmera não conecta | Verificar se a rede do PDV permite conexões outbound na porta 1935 |
| Stream instável | Usar stream "Econômica" para reduzir bandwidth |
| Câmera fica offline após minutos | Verificar estabilidade do Wi-Fi no PDV |
| Stream key rejeitada | Confirmar que a stream key foi cadastrada na API |

## Firmware validado

- **iM5 SC**: firmware `2.800.00IB01X.0.R.240927` (validado em campo)
