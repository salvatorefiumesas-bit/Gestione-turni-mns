# Manutenzione Stradale – Gestione Turni (PWA)

App installabile (PWA) con splash screen, login amministratore e sincronizzazione su Firebase.

## File del progetto
```
index.html            app (turni, coppie fisse, vista smartphone)
sync.js               login admin + sincronizzazione Firebase
firebase-config.js    <-- qui incolli i dati del tuo progetto Firebase
manifest.webmanifest  dati di installazione (nome, colori, icone)
sw.js                 funzionamento offline
.nojekyll
icons/                icone dell'app
```

## 1) Pubblicare su GitHub Pages
1. Crea un repository su GitHub (es. `turni`) e carica **tutti** i file mantenendo la cartella `icons/`
   (da PC: *Add file > Upload files* e trascina file e cartella).
2. *Settings > Pages > Build and deployment > Source: Deploy from a branch* → branch `main`, cartella `/ (root)` → *Save*.
3. Dopo 1–2 minuti l'app è su `https://TUO-UTENTE.github.io/turni/`.

## 2) Creare il progetto Firebase
1. https://console.firebase.google.com → *Aggiungi progetto* (Analytics non serve).
2. **Authentication** > *Inizia* > *Metodo di accesso* > abilita **Email/password**.
3. **Authentication > Utenti > Aggiungi utente**: inserisci email e password dell'amministratore.
4. **Authentication > Impostazioni > Domini autorizzati > Aggiungi dominio**: `TUO-UTENTE.github.io`.
5. **Firestore Database > Crea database** (sede `eur3` o `europe-west`). Per ora scegli la modalità *test*;
   le regole definitive e chiuse arrivano dopo.
6. **Impostazioni progetto (ingranaggio) > Generali > Le tue app > Web (`</>`)**: registra l'app e copia
   la configurazione in `firebase-config.js`, poi ricarica il file su GitHub.

## 3) Portare i dati già esistenti
Nel vecchio file HTML premi **SALVA BACKUP**. Nella nuova app, dopo il login, premi **RIPRISTINA BACKUP**:
i dati vengono caricati nel cloud e compaiono su tutti i dispositivi.

## 4) Installare sullo smartphone
- **Android (Chrome):** menu ⋮ > *Installa app*.
- **iPhone (Safari):** Condividi > *Aggiungi alla schermata Home*.

## Aggiornamenti
Dopo aver modificato i file su GitHub, cambia `VERSION` in `sw.js` (es. `turni-v2`) per forzare il rinnovo della cache.
