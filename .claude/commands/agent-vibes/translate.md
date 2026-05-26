---
description: 'Configure automatic TTS translation to speak in your preferred language'
---

# /agent-vibes:translate - Multi-Language TTS Translation

Configure AgentVibes to automatically translate English TTS text to your preferred language before speaking.

**Usage:**

- `/agent-vibes:translate` - Show current translation settings
- `/agent-vibes:translate set <language>` - Set translation language
- `/agent-vibes:translate off` - Disable translation (speak English)
- `/agent-vibes:translate status` - Show detailed status

**Arguments:** $ARGUMENTS

## How It Works

When translation is enabled, AgentVibes will:

1. Take the English TTS text
2. Translate it to your target language using Google Translate
3. Speak the translated text using a language-appropriate voice

## Priority Order

1. **Manual override** (`/agent-vibes:translate set spanish`) - Highest priority
2. **Default** - No translation (English)

## Supported Languages

Spanish, French, German, Italian, Portuguese, Chinese, Japanese, Korean, Russian, Polish, Dutch, Turkish, Arabic, Hindi, Swedish, Danish, Norwegian, Finnish, Czech, Romanian, Ukrainian, Greek, Bulgarian, Croatian, Slovak

## Examples

```bash
# Translate all TTS to Spanish
/agent-vibes:translate set spanish

# Disable translation (speak English)
/agent-vibes:translate off

# Check current settings
/agent-vibes:translate status
```

---

Execute the translate-manager.sh script:

```bash
.claude/hooks/translate-manager.sh $ARGUMENTS
```
