# Nous Deux Native Android

Couche Android native du module de localisation.

Fonctions:

- WebView de l'interface Nous Deux existante.
- Service de premier plan `location` pour continuer le suivi écran éteint.
- Synchronisation directe avec Supabase pour `current_locations` et `location_history`.
- Rafraîchissement natif du jeton Supabase.
- Jetons chiffrés par Android Keystore.
- Reprise après redémarrage lorsque l'autorisation `Toujours autoriser` est accordée.
- Notification permanente pendant le suivi.
- Détection conservatrice d'impact avec délai de 45 secondes, bouton `Je vais bien` et envoi d'une alerte au cercle si aucune annulation n'est reçue.

Cible: Android 16, API 36. Java 17. AGP 8.13.2, Gradle 8.13.

Le service doit être démarré depuis l'activité visible, conformément aux restrictions Android modernes sur les services de premier plan utilisant la localisation.
