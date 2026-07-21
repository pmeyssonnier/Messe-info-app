# Messe-info-app — Messes à proximité

Application web (PWA) pour trouver les **célébrations de messes en France** autour d'un lieu, les afficher sur une carte et les classer par distance.

Les données proviennent de **[messes.info](https://messes.info)** (Conférence des évêques de France) et le géocodage de la **[Base Adresse Nationale](https://adresse.data.gouv.fr)**.

🔗 **Site en ligne :** https://pmeyssonnier.github.io/Messe-info-app/

## Fonctionnalités

- **Recherche par lieu** — ville, code postal ou adresse, avec autocomplétion (Base Adresse Nationale). On choisit une suggestion dans la liste, ou on valide avec **Entrée** ; une **croix** efface le champ.
- **« Autour de moi »** — recherche autour de sa position GPS.
- **Carte interactive** (Leaflet / OpenStreetMap) :
  - marqueur en forme d'**église surmontée d'une croix** par lieu (doré pour un favori), avec une pastille du nombre de célébrations quand un lieu en regroupe plusieurs ;
  - bouton **« Recadrer »** (haut-droite) pour cadrer sur les résultats, bouton **« ma position »** (bas-droite) pour centrer sur soi ;
  - plusieurs fonds de carte (OSM standard, OSM France, CARTO), bascule automatique en cas d'indisponibilité.
- **Panneau « Prochaines messes »** — à la sélection d'une église (carte ou liste) : ses prochaines célébrations, plus ses **horaires habituels** récupérés de sa fiche messes.info (dont les messes de semaine), et des liens (paroisse, fiche, itinéraire).
- **Favoris ★** — épinglage des églises (bouton étoile sur les cartes et les popups), avec une section **« Mes favoris »** (accès rapide) et un filtre « Favoris uniquement ». Conservés localement dans le navigateur.
- **Filtres** (accordéon repliable) — recherche texte, ville, code postal, jour, date de début, distance maximale, tri (date / distance / ville), « uniquement à venir » et « favoris uniquement ».
- **Exports** — **CSV**, **iCal** (`.ics`, importable dans n'importe quel agenda) et **Google Agenda** (ajout d'une célébration en un clic).
- **Dédoublonnage** — fusion des célébrations en double (même église, même date/heure).
- **Repli de géocodage** — les célébrations sans coordonnées dans messes.info sont replacées via la Base Adresse Nationale (au centre de la commune), au lieu d'être écartées.
- **Heure de dernière actualisation** des horaires.
- **Statistiques** — nombre de célébrations, résultats affichés, communes, plus proche.
- **Session mémorisée** — dernière recherche, filtres et favoris restaurés au rechargement.

## Application installable (PWA)

L'application est une **Progressive Web App** : elle s'installe sur mobile et bureau, s'ouvre en plein écran et sa coquille fonctionne **hors-ligne** (les horaires nécessitent une connexion).

- **Android / Chrome** : bouton **« 📲 Installer l'application »**, ou menu ⋮ → *Ajouter à l'écran d'accueil*.
- **iOS / Safari** : bouton **Partager** → *Sur l'écran d'accueil*.

## Utilisation

Aucune installation ni serveur nécessaire côté développement : ce sont des fichiers statiques.

- **En ligne** : https://pmeyssonnier.github.io/Messe-info-app/
- **En local** : servez le dossier avec un petit serveur HTTP (nécessaire pour le service worker), par ex. `python3 -m http.server`, puis ouvrez `http://localhost:8000/`.

> ℹ️ Le chargement direct des pages messes.info peut être bloqué par la politique **CORS** du navigateur ; l'application teste automatiquement des proxys publics de secours. Pour un usage régulier et fiable, l'idéal est de passer par votre propre fonction serveur ou l'API v2 de messes.info (une `userkey` peut être demandée à `contact.messesinfo@cef.fr`).

## Structure du projet

| Fichier | Rôle |
|---|---|
| `index.html` | structure de la page |
| `styles.css` | styles |
| `app.js` | logique applicative + enregistrement PWA |
| `sw.js` | service worker (cache / hors-ligne) |
| `manifest.webmanifest` | manifeste PWA |
| `icons/` | icônes de l'application (192 / 512, maskable) |

- **Aucune dépendance à installer** : Leaflet est chargé depuis un CDN, le reste tient dans les fichiers ci-dessus.
- **Stockage local** (`localStorage`) : session et favoris ; rien n'est envoyé à un serveur tiers en dehors des appels d'API publics (messes.info, Base Adresse Nationale, tuiles OpenStreetMap).
- **Hébergement** : GitHub Pages, servi depuis la branche `main` (racine).

## Sources de données et attribution

- Célébrations : [messes.info](https://messes.info) — Conférence des évêques de France.
- Géocodage : [Base Adresse Nationale](https://adresse.data.gouv.fr) (API Adresse, service public gratuit).
- Fonds de carte : [OpenStreetMap](https://www.openstreetmap.org/copyright) et contributeurs, CARTO.
- Cartographie : [Leaflet](https://leafletjs.com).

## Licence

Distribué sous licence **MIT**. Voir le fichier [`LICENSE`](LICENSE).

## Avertissement

Cette application lit des informations publiques. Les horaires affichés dépendent de la mise à jour des paroisses sur messes.info ; **vérifiez toujours auprès de la paroisse** en cas de doute. Les distances sont calculées à vol d'oiseau.
