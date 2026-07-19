# Messe-info-app — Messes à proximité

Application web autonome (un seul fichier `index.html`) pour trouver les **célébrations de messes en France** autour d'un lieu, les afficher sur une carte et les classer par distance.

Les données proviennent de **[messes.info](https://messes.info)** (Conférence des évêques de France) et le géocodage de la **[Base Adresse Nationale](https://adresse.data.gouv.fr)**.

🔗 **Site en ligne :** https://pmeyssonnier.github.io/Messe-info-app/

## Fonctionnalités

- **Recherche par lieu** — ville, code postal ou adresse, avec autocomplétion (Base Adresse Nationale) ; lancement via le bouton **Rechercher** ou la touche Entrée.
- **Géolocalisation** — bouton « Ma position » pour partir de sa localisation GPS.
- **Carte interactive** (Leaflet / OpenStreetMap) — un marqueur en forme d'**église avec une croix** par lieu ; pastille indiquant le nombre de célébrations quand un lieu en regroupe plusieurs.
- **Panneau « Prochaines messes »** — à la sélection d'une église (carte ou liste), affichage de toutes ses prochaines célébrations, triées par date.
- **Favoris ★** — épinglage des églises (bouton étoile sur les cartes et les popups), conservés localement dans le navigateur, avec filtre « Favoris uniquement ».
- **Filtres** — recherche texte, ville, code postal, jour, date de début, distance maximale, tri (date / distance / ville) et « uniquement à venir ».
- **Statistiques** — nombre de célébrations, résultats affichés, communes, plus proche.
- **Export** — CSV (et iCal).
- **Distances** — calcul à vol d'oiseau depuis le point de référence.
- **Session mémorisée** — dernière recherche et filtres restaurés au rechargement.

## Utilisation

Aucune installation ni serveur : l'application est un unique fichier HTML.

- **En ligne** : ouvrez https://pmeyssonnier.github.io/Messe-info-app/
- **En local** : ouvrez `index.html` dans un navigateur récent.

> ℹ️ Le chargement direct des pages messes.info peut être bloqué par la politique **CORS** du navigateur ; l'application teste automatiquement des proxys publics de secours. Pour un usage régulier et fiable, l'idéal est de passer par votre propre fonction serveur ou l'API v2 de messes.info (une `userkey` peut être demandée à `contact.messesinfo@cef.fr`).

## Détails techniques

- **Aucune dépendance à installer** : Leaflet est chargé depuis un CDN, tout le code applicatif tient dans `index.html`.
- **Stockage local** (`localStorage`) : session et favoris, rien n'est envoyé à un serveur tiers en dehors des appels d'API publics (messes.info, Base Adresse Nationale, tuiles OpenStreetMap).
- **Hébergement** : GitHub Pages, servi depuis la branche `main` (racine).

## Sources de données et attribution

- Célébrations : [messes.info](https://messes.info) — Conférence des évêques de France.
- Géocodage : [Base Adresse Nationale](https://adresse.data.gouv.fr) (API Adresse, service public gratuit).
- Fonds de carte : [OpenStreetMap](https://www.openstreetmap.org/copyright) et contributeurs, CARTO.

## Licence

Distribué sous licence **MIT**. Voir le fichier [`LICENSE`](LICENSE).

## Avertissement

Cette application lit des informations publiques. Les horaires affichés dépendent de la mise à jour des paroisses sur messes.info ; vérifiez toujours auprès de la paroisse en cas de doute. Les distances sont calculées à vol d'oiseau.
