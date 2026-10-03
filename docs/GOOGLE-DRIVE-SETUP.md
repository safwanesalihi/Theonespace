# Google Drive — configuration et utilisation

## Ce qui est intégré

Un compte Google Drive par workspace d’agence. Le propriétaire le connecte une seule fois dans **Paramètres → Google Drive**, puis choisit le dossier agence via Google Picker. Chaque client possède un dossier principal distinct, créé à partir d’un plan adapté à son brief et à son périmètre de production.

**Client → Fichiers → Organisation** : génération IA à partir du brief enregistré, des formats/quantités du contrat accepté actif (ou du périmètre client si aucun contrat actif), et des sous-projets. Une story individuelle reste un frame = une unité. Aucun prix, paiement ou document financier n’est envoyé au modèle. Le responsable peut modifier les noms, usages et parents, ajouter/retirer des dossiers, importer/exporter du JSON puis confirmer la création dans Drive.

**Client → Fichiers** : navigation dans les dossiers, recherche dans les pages chargées du dossier courant, upload jusqu’à 1 Go, reprise d’un transfert interrompu tant que la page conserve le fichier sélectionné, nouvelle version d’un fichier, renommage, déplacement à l’intérieur du même client, téléchargement et corbeille réversible. Le propriétaire peut sélectionner des fichiers déjà présents dans Google Drive et confirmer leur déplacement dans le dossier client.

Les listes sont relues directement dans Google Drive : actualisation manuelle, au retour sur la page et toutes les 30 secondes lorsque l’onglet est visible et qu’aucune opération n’est en cours. Les changements effectués dans Drive apparaissent ainsi dans l’application. Le plan JSON décrit la structure initiale ; il ne renomme pas automatiquement les dossiers modifiés ensuite dans Drive.

## 1. Google Cloud — projet et APIs

Dans [Google Cloud Console](https://console.cloud.google.com/), créer ou choisir un projet pour cette intégration. Un projet dédié évite de mélanger les autorisations Drive avec YouTube ou d’autres connexions.

Dans **APIs & Services → Library**, activer :

- **Google Drive API**.
- **Google Picker API**.

Dans **Project settings / Dashboard**, relever le **Project number** numérique. Ne pas utiliser le nom ou le Project ID textuel.

## 2. Google Auth Platform — consentement

Configurer **Branding**, **Audience** et **Data Access** : nom du SaaS, e-mail de support, domaine autorisé `the1core.com`, page d’accueil, politique de confidentialité et conditions réelles de l’application.

Pour connecter un Gmail personnel ou permettre à plusieurs agences de connecter leurs comptes, choisir **External**. **Internal** convient uniquement aux utilisateurs de votre propre organisation Google Workspace. En mode Testing, ajouter le compte Google de l’agence aux **Test users**.

Ajouter uniquement ce scope dans Data Access :

```text
https://www.googleapis.com/auth/drive.file
```

Ce scope donne accès aux fichiers créés par l’application ou autorisés individuellement avec Picker. Choisir un dossier existant autorise ce dossier, **pas tous ses descendants déjà présents**. Pour autoriser un fichier existant dans le dossier client, sélectionner ce fichier via **Importer depuis Drive** ; s’il se trouve déjà au bon emplacement, il n’est pas déplacé une deuxième fois. Les fichiers nouvellement créés depuis l’application sont accessibles directement. [Documentation officielle des scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Avant utilisation durable, passer la publication du consentement en **Production** et terminer les vérifications de branding/domaines demandées par Google. En mode External + Testing, les refresh tokens des scopes Drive expirent après 7 jours. L’application demande une reconnexion lorsqu’un accès expire ou est révoqué. [Expiration des tokens](https://developers.google.com/identity/protocols/oauth2#expiration).

## 3. Créer le client OAuth

Réutiliser votre client OAuth **Web application** existant, ou créer un client dédié dans **Google Auth Platform → Clients → Create client → Web application**. Ajouter le callback Drive au client choisi en conservant ses autres callbacks.

Authorized JavaScript origins :

```text
https://space.the1core.com
```

Authorized redirect URIs :

```text
https://space.the1core.com/api/drive/callback
```

Pour un test local, ajouter séparément :

```text
Origin: http://127.0.0.1:5173
Redirect: http://127.0.0.1:5173/api/drive/callback
```

Le schéma HTTPS, le domaine, le port local et le chemin doivent correspondre exactement à `AUTH_URL` de l’environnement concerné. Pour un autre domaine de production, remplacer les deux URLs par ce domaine. Les previews Vercel nécessitent leur propre URL autorisée et un `AUTH_URL` cohérent ; commencer par la production stable ou le localhost, pas une URL de preview variable.

Pour un client dédié, récupérer **Client ID** et **Client secret**. Si les valeurs du client existant sont déjà stockées dans `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (ou `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET`), le code peut les réutiliser sans lire/copier le secret. La connexion, le consentement et les tokens Drive restent distincts de YouTube ou du login. Le secret reste dans Vercel, jamais dans un message ou dans Git. [Flux OAuth serveur Google](https://developers.google.com/identity/protocols/oauth2/web-server).

## 4. Créer la clé Google Picker

Dans **APIs & Services → Credentials → Create credentials → API key**, dans **le même projet** que le client OAuth :

- Application restrictions : **Websites / HTTP referrers**.
- Autoriser `https://space.the1core.com/*` et, uniquement pour vos tests, `http://127.0.0.1:5173/*`.
- API restrictions : restreindre à **Google Picker API**.

La clé Picker et le numéro de projet sont destinés au navigateur. Le client secret OAuth et le refresh token restent sur le serveur. Le navigateur du propriétaire reçoit seulement un access token de courte durée pour ouvrir le Picker Google. [Google Picker](https://developers.google.com/workspace/drive/api/guides/picker).

## 5. Vercel — variables d’environnement

Dans le projet de l’application → **Settings → Environment Variables**, ajouter en **Production** :

| Variable | Valeur attendue |
| --- | --- |
| `GOOGLE_DRIVE_CLIENT_ID` | Client ID du client OAuth Web dédié ; optionnel si une paire Google existante est configurée |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Client secret du même client dédié ; même condition |
| `GOOGLE_DRIVE_PICKER_KEY` | API key restreinte à Picker et aux domaines de l’application |
| `GOOGLE_DRIVE_PROJECT_NUMBER` | Project number numérique du même projet |
| `AUTH_URL` | `https://space.the1core.com` |
| `AUTH_SECRET` | **Conserver la valeur existante**, au moins 32 caractères |

Si vous réutilisez le client existant, laisser **les deux** variables `GOOGLE_DRIVE_CLIENT_*` absentes ou vides. Le serveur sélectionne la paire dédiée en priorité, puis `GOOGLE_CLIENT_*`, puis `AUTH_GOOGLE_*`. Une paire partielle est refusée : le code ne mélange jamais ID et secret de clients différents. Ajouter seulement la clé Picker et le numéro du projet correspondant.

Ne pas utiliser un préfixe `NEXT_PUBLIC_`. `AUTH_SECRET` chiffre aussi les connexions sociales existantes : ne pas la remplacer pour activer Drive. Si elle est absente, créer une valeur aléatoire longue dans Vercel avant la première connexion. `GEMINI_API_KEY` ou `GROQ_API_KEY` déjà configurée suffit pour le générateur ; aucune nouvelle clé IA n’est nécessaire.

**Redéployer** la production après l’ajout des variables. Aucune migration SQL supplémentaire : les connexions chiffrées, plans et transferts utilisent les métadonnées privées de la base existante.

## 6. Première connexion et vérification réelle

1. Se connecter à l’application avec le rôle **Owner**.
2. Ouvrir **Paramètres → Google Drive → Connecter Google Drive**.
3. Choisir le compte Google de travail et accepter l’accès aux fichiers autorisés à l’application.
4. **Choisir le dossier agence** : sélectionner un dossier déjà créé dans **Mon Drive** ou dans un **Drive partagé** où ce compte peut ajouter des fichiers.
5. Ouvrir un client avec son brief complété → **Fichiers → Générer depuis le brief**.
6. Vérifier le plan, l’enregistrer et confirmer **Créer dans Google Drive**.
7. Vérifier le dossier dans Google Drive ; uploader un petit fichier, le renommer, le déplacer puis tester corbeille/restauration.
8. Modifier son nom depuis Drive et actualiser dans l’application pour vérifier la synchronisation.

Pour un Drive partagé, le compte connecté doit avoir les droits adaptés : création, modification, déplacement et corbeille peuvent avoir des droits différents. L’application respecte les capacités retournées par Google et n’accorde aucun droit Drive supplémentaire. Elle utilise `supportsAllDrives` et recherche dans le Drive partagé associé au dossier. Elle ne crée pas un nouvel espace Shared Drive. [Shared Drive support](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives).

## Accès et récupération

- **Owner** : connexion/déconnexion, choix du dossier agence et import Google Picker.
- **Owner + Admin** : plan et gestion des fichiers de production des clients de leur workspace.
- Autres membres et portail client : aucun accès à la connexion ni aux API de gestion Drive.
- Aucun partage public automatique. Les liens Drive restent soumis aux droits Google du visiteur ; un administrateur peut télécharger via l’application les fichiers dont l’accès est autorisé au compte agence.
- Aucun effacement définitif. Déconnecter retire l’autorisation enregistrée dans l’application, sans supprimer les fichiers Drive. Pour révoquer aussi l’autorisation chez Google, le propriétaire peut utiliser les paramètres de son compte Google.
- Si la création s’interrompt, utiliser **Reprendre la création**. Les IDs pré-générés et la progression persistée empêchent les doublons après une réponse réseau perdue. [IDs Google Drive et reprises](https://developers.google.com/workspace/drive/api/guides/create-file).
- Si un upload s’interrompt, utiliser **Reprendre le transfert** dans la même page. La reprise interroge les octets déjà reçus par Drive. Un rechargement complet perd le fichier local en mémoire : le sélectionner de nouveau lance un nouveau transfert. Les sessions serveur sont chiffrées et expirent après 24 h ; leurs métadonnées expirées sont purgées au prochain démarrage d’upload du workspace. [Uploads reprenables](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
- Un client créé dans un compte Drive reste lié à ce compte. Pour le retrouver après avoir changé de connexion, reconnecter son compte d’origine. Pour reprendre une création incomplète, sélectionner aussi le dossier agence d’origine. Un changement de compte ne déplace jamais les dossiers existants.
- Si le dossier principal client est supprimé/archivé dans Drive, le restaurer depuis Drive. Le browser de l’application ne peut pas déplacer ou mettre son propre dossier principal à la corbeille.

## Informations à transmettre après configuration

Confirmer que les deux APIs sont actives, que la clé Picker et le numéro du projet sont enregistrés, qu’une paire OAuth complète est configurée (existante ou dédiée), que la production a été redéployée et que la connexion Google a réussi. En cas d’erreur, transmettre le **message affiché** et l’URL de callback configurée. **Ne pas transmettre le client secret, les tokens ou AUTH_SECRET dans le chat.**

La configuration Google et la première autorisation réelle restent à faire sur vos comptes. Les tests automatisés utilisent un serveur Google simulé ; ils ne prouvent pas les permissions de votre compte ou la validité de vos clés de production.
