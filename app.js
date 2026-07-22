// Application « Messes à proximité » — logique principale + PWA
"use strict";

    const state = {
      masses: [],
      filtered: [],
      userPosition: null,
      markers: [],
      markerLayer: null,
      userMarker: null,
      selectedIndex: null,
      detailMass: null,
      detailCache: new Map(),
      loadedAt: null,
      pageSize: 60,
      shown: 60
    };

    const STORE_KEY = "messes_app_v2";
    const FAV_KEY = "messes_favoris_v1";

    /* ------------------------------------------------------------
       Favoris : églises épinglées par l'utilisateur.
       Persistés dans localStorage, indépendamment du jeu de données
       courant, avec assez d'informations pour rester identifiables
       même après un rechargement (nom + code postal).
       ------------------------------------------------------------ */
    function loadFavorites() {
      try { return JSON.parse(localStorage.getItem(FAV_KEY)) || {}; }
      catch (e) { return {}; }
    }

    state.favorites = loadFavorites();
    state.favLookup = new Map();

    function favKey(m) {
      return `${normalize(m.church)}|${String(m.postalCode || "").trim()}`;
    }

    function isFavorite(m) {
      return Object.prototype.hasOwnProperty.call(state.favorites, favKey(m));
    }

    function saveFavorites() {
      try { localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites)); }
      catch (e) { /* quota : non bloquant */ }
    }

    function toggleFavorite(m) {
      if (!m) return;
      const key = favKey(m);
      if (isFavorite(m)) {
        delete state.favorites[key];
        setStatus(`« ${m.church} » retiré des favoris.`, "");
      } else {
        state.favorites[key] = {
          church: m.church, city: m.city, postalCode: m.postalCode,
          latitude: m.latitude, longitude: m.longitude
        };
        setStatus(`« ${m.church} » ajouté aux favoris.`, "success");
      }
      saveFavorites();
      renderFavPanel();
      applyFilters();
    }

    // Bascule depuis un popup de carte (clé encodée pour l'attribut onclick)
    window.__toggleFav = function (encodedKey) {
      const key = decodeURIComponent(encodedKey);
      const m = state.favLookup.get(key);
      if (m) toggleFavorite(m);
    };

    // Petite icône « église » (bâtiment blanc) pour la liste des favoris
    const FAV_CHURCH_SVG =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#fff" aria-hidden="true">' +
      '<rect x="11.25" y="2" width="1.5" height="4.6" rx="0.4"/>' +
      '<rect x="9.7" y="3.3" width="4.6" height="1.5" rx="0.4"/>' +
      '<path d="M12 6.6 4.8 11.2V22H10v-4.2a2 2 0 0 1 4 0V22h5.2V11.2z"/>' +
      '</svg>';

    // Liste « Mes favoris » : accès rapide aux églises épinglées
    function renderFavPanel() {
      if (!els.favPanel) return;
      const entries = Object.entries(state.favorites);
      if (!entries.length) {
        els.favPanel.hidden = true;
        els.favList.innerHTML = "";
        return;
      }

      els.favList.innerHTML = entries.map(([key, f]) => `
        <div class="fav-item" data-fav-key="${escapeHtml(encodeURIComponent(key))}" role="button" tabindex="0"
             aria-label="Voir les messes de ${escapeHtml(f.church || "")}">
          <span class="fav-item-ico">${FAV_CHURCH_SVG}</span>
          <span class="fav-item-txt">
            <span class="fav-item-name">${escapeHtml(f.church || "")}</span>
            <span class="fav-item-place">${escapeHtml(f.postalCode || "")} ${escapeHtml(f.city || "")}</span>
          </span>
          <span class="fav-item-remove" data-remove role="button" tabindex="0"
                aria-label="Retirer des favoris" title="Retirer des favoris">✕</span>
        </div>
      `).join("");
      els.favPanel.hidden = false;

      els.favList.querySelectorAll(".fav-item").forEach(item => {
        const key = decodeURIComponent(item.dataset.favKey);
        const remove = item.querySelector("[data-remove]");
        if (remove) {
          remove.addEventListener("click", e => {
            e.stopPropagation();
            delete state.favorites[key];
            saveFavorites();
            renderFavPanel();
            applyFilters();
            setStatus("Favori retiré.", "");
          });
        }
        const open = () => openFavorite(key);
        item.addEventListener("click", open);
        item.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        });
      });
    }

    // Ouvre un favori : recentre sur l'église et charge ses messes
    function openFavorite(key) {
      const f = state.favorites[key];
      if (!f) return;
      if (!Number.isFinite(f.latitude) || !Number.isFinite(f.longitude)) {
        setStatus("Coordonnées du favori indisponibles.", "warning");
        return;
      }
      els.placeSearch.value = "";
      updatePlaceClear();
      const place = f.city ? ` — ${f.postalCode ? f.postalCode + " " : ""}${f.city}` : "";
      setOrigin(f.latitude, f.longitude, `${f.church}${place}`, "address");
      setStatus(`Chargement des messes autour de « ${f.church} »…`, "warning");
      loadMasses();
    }

    function debounce(fn, delay = 220) {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
    }

    function saveSession() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          placeSearch: els.placeSearch.value,
          apiLat: els.apiLat.value,
          apiLng: els.apiLng.value,
          userKey: els.userKey.value,
          sourceMode: els.sourceMode.value,
          masses: state.masses,
          loadedAt: state.loadedAt,
          userPosition: state.userPosition,
          filters: {
            textSearch: els.textSearch.value,
            cityFilter: els.cityFilter.value,
            postalFilter: els.postalFilter.value,
            dayFilter: els.dayFilter.value,
            dateFrom: els.dateFrom.value,
            maxDistance: els.maxDistance.value,
            sortBy: els.sortBy ? els.sortBy.value : "auto",
            onlyFuture: els.onlyFuture ? els.onlyFuture.checked : false,
            onlyFav: els.onlyFav ? els.onlyFav.checked : false
          },
          savedAt: Date.now()
        }));
      } catch (e) { /* quota : non bloquant */ }
    }

    function restoreSession() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!Array.isArray(data.masses) || !data.masses.length) return false;
        if (data.placeSearch) els.placeSearch.value = data.placeSearch;
        if (data.apiLat) els.apiLat.value = data.apiLat;
        if (data.apiLng) els.apiLng.value = data.apiLng;
        if (data.userKey) els.userKey.value = data.userKey;
        if (data.sourceMode) els.sourceMode.value = data.sourceMode;
        state.userPosition = data.userPosition || null;
        state.masses = data.masses;
        state.loadedAt = Number.isFinite(data.loadedAt) ? data.loadedAt : (data.savedAt || null);
        updateRefreshInfo();
        rebuildFilterOptions();

        /* Un filtre mémorisé peut ne plus exister dans le nouveau jeu de
           données (ville renommée, cache antérieur à un correctif…).
           On ne le réapplique que s'il figure parmi les options réelles,
           sinon le select garderait une valeur fantôme filtrant tout. */
        const f = data.filters || {};
        const applyIfValid = (select, value) => {
          if (!value) { select.value = ""; return; }
          const exists = [...select.options].some(o => o.value === value);
          select.value = exists ? value : "";
        };

        els.textSearch.value = f.textSearch || "";
        applyIfValid(els.cityFilter, f.cityFilter);
        applyIfValid(els.postalFilter, f.postalFilter);
        applyIfValid(els.dayFilter, f.dayFilter);
        els.dateFrom.value = f.dateFrom || "";
        els.maxDistance.value = f.maxDistance || "";
        if (els.sortBy) els.sortBy.value = f.sortBy || "date";
        if (els.onlyFuture) els.onlyFuture.checked = !!f.onlyFuture;
        if (els.onlyFav) els.onlyFav.checked = !!f.onlyFav;
        updateDistances();
        if (state.userPosition) drawUserMarker();
        applyFilters(true);
        return true;
      } catch (e) { return false; }
    }

    const els = Object.fromEntries([
      "placeSearch", "placeSuggest", "placeClear", "locateBtn", "status",
      "sourceMode", "favPanel", "favList",
      "totalCount", "visibleCount", "cityCount", "nearestValue",
      "textSearch", "cityFilter", "postalFilter", "dayFilter",
      "dateFrom", "maxDistance", "resetBtn", "results", "refreshInfo", "churchDetail", "csvBtn",
      "sortBy", "onlyFuture", "onlyFav", "moreBtn", "icsBtn",
      "apiLat", "apiLng", "apiDays", "userKey"
    ].map(id => [id, document.getElementById(id)]));

    const map = L.map("map").setView([46.8, 2.5], 6);
    const osmFr = L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
      maxZoom: 20, subdomains: "abc", crossOrigin: true,
      attribution: "&copy; OpenStreetMap France"
    });

    const osmStd = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, crossOrigin: true,
      attribution: "&copy; OpenStreetMap"
    });

    const carto = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20, subdomains: "abcd", crossOrigin: true,
      attribution: "&copy; OpenStreetMap, &copy; CARTO"
    });

    osmStd.addTo(map);

    // Repli automatique si le fournisseur de tuiles échoue
    let tileErrors = 0;
    osmStd.on("tileerror", () => {
      if (++tileErrors === 6 && map.hasLayer(osmStd)) {
        map.removeLayer(osmStd);
        carto.addTo(map);
        setStatus("Fond de carte principal indisponible, bascule sur CARTO.", "warning");
      }
    });

    L.control.layers(
      { "OSM standard": osmStd, "OSM France": osmFr, "CARTO Voyager": carto },
      null,
      { position: "topright" }
    ).addTo(map);

    L.control.scale({ imperial: false }).addTo(map);

    /* Bouton « Recadrer » superposé au coin supérieur droit de la carte
       (recadre la vue sur les résultats ; le filtrage ne bouge plus la carte). */
    const FitControl = L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const btn = L.DomUtil.create("button", "map-fit-btn");
        btn.type = "button";
        btn.textContent = "Recadrer";
        btn.title = "Recadrer la carte sur les résultats";
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, "click", () => {
          if (!state.filtered.length) {
            setStatus("Aucun résultat à cadrer.", "warning");
            return;
          }
          renderMap(true);
        });
        return btn;
      }
    });
    map.addControl(new FitControl());

    /* Bouton « ma position » superposé au coin inférieur droit de la carte :
       centre sur la position locale (GPS). Si elle n'est pas encore connue,
       il lance la géolocalisation. */
    function centerOnUser() {
      if (state.userPosition && state.userPosition.kind === "gps") {
        map.setView([state.userPosition.lat, state.userPosition.lng], Math.max(map.getZoom(), 14));
        if (state.userMarker) state.userMarker.openPopup();
      } else {
        locateUser();
      }
    }

    const LocateControl = L.Control.extend({
      options: { position: "bottomright" },
      onAdd() {
        const btn = L.DomUtil.create("button", "map-locate-btn");
        btn.type = "button";
        btn.title = "Centrer sur ma position";
        btn.setAttribute("aria-label", "Centrer sur ma position");
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="7" />' +
          '<line x1="12" y1="1.5" x2="12" y2="4.5" /><line x1="12" y1="19.5" x2="12" y2="22.5" />' +
          '<line x1="1.5" y1="12" x2="4.5" y2="12" /><line x1="19.5" y1="12" x2="22.5" y2="12" />' +
          '<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" /></svg>';
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, "click", centerOnUser);
        return btn;
      }
    });
    map.addControl(new LocateControl());

    state.markerLayer = L.layerGroup().addTo(map);

    // Recalcule la taille dès que le conteneur devient visible / change de taille
    if (window.ResizeObserver) {
      new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById("map"));
    }

    const monthMap = {
      janv: 0, janvier: 0,
      févr: 1, fevr: 1, février: 1, fevrier: 1,
      mars: 2,
      avr: 3, avril: 3,
      mai: 4,
      juin: 5,
      juil: 6, juillet: 6,
      août: 7, aout: 7,
      sept: 8, septembre: 8,
      oct: 9, octobre: 9,
      nov: 10, novembre: 10,
      déc: 11, dec: 11, décembre: 11, decembre: 11
    };

    const dayNames = [
      "dimanche", "lundi", "mardi", "mercredi",
      "jeudi", "vendredi", "samedi"
    ];

    // Formes courtes affichées devant la date : Dim, Lun, Mar…
    const dayShort = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

    /* Libellé affiché : « Dim 19 juillet 2026 - 10h30 ».
       Centralisé ici car dateLabel provient de 3 sources
       (scraping, API v2, jeu de démonstration). */
    function displayDate(mass) {
      const base = mass.dateLabel || "";
      if (!Number.isFinite(mass.timestamp)) return base;

      const prefix = dayShort[new Date(mass.timestamp).getDay()];

      // Évite un doublon si le libellé commence déjà par un nom de jour
      const already = new RegExp(`^(${dayShort.join("|")}|${dayNames.join("|")})\\b`, "i");
      if (already.test(base.trim())) return base;

      return `${prefix} ${base}`;
    }

    function normalize(value = "") {
      return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    }

    let statusTimer = null;
    function setStatus(message, type = "") {
      els.status.textContent = message || "";
      els.status.className = `status ${type}`.trim();
      els.status.hidden = !message;
      clearTimeout(statusTimer);
      // Les messages d'info/chargement/succès disparaissent seuls (pas d'encombrement).
      if (message && type !== "error") {
        statusTimer = setTimeout(() => {
          els.status.textContent = "";
          els.status.hidden = true;
          els.status.className = "status";
        }, 4500);
      }
    }

    function parseFrenchDate(raw) {
      const clean = raw.replace(/\./g, "").replace(/\s+/g, " ").trim();
      const match = clean.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})\s*-\s*(\d{1,2})h(\d{2})(?:\s*-\s*(.*))?/i);
      if (!match) return { iso: "", timestamp: NaN, hour: "", celebration: "" };

      const monthKey = normalize(match[2]);
      const month = monthMap[monthKey];
      if (month === undefined) return { iso: "", timestamp: NaN, hour: "", celebration: "" };

      const date = new Date(
        Number(match[3]),
        month,
        Number(match[1]),
        Number(match[4]),
        Number(match[5])
      );

      const iso = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");

      return {
        iso,
        timestamp: date.getTime(),
        hour: `${String(match[4]).padStart(2, "0")}:${match[5]}`,
        celebration: (match[6] || "").trim()
      };
    }

    function safeText(node) {
      return node?.textContent?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() || "";
    }

    function parseMessesInfo(html, sourceUrl) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const dateHeaders = [...doc.querySelectorAll("h3")];
      const masses = [];

      for (const h3 of dateHeaders) {
        const dateLabel = safeText(h3);
        if (!/\d{1,2}\s+[A-Za-zÀ-ÿ.]+\s+\d{4}\s*-\s*\d{1,2}h\d{2}/i.test(dateLabel)) continue;

        let cursor = h3.nextElementSibling;
        let churchNode = null;
        const blockNodes = [];

        while (cursor && cursor.tagName !== "H3") {
          blockNodes.push(cursor);
          if (!churchNode && cursor.tagName === "H4") churchNode = cursor;
          cursor = cursor.nextElementSibling;
        }

        const blockText = blockNodes.map(safeText).join(" | ");
        const churchText = safeText(churchNode);
        const churchLink = churchNode?.querySelector("a");

        const locationMatch = blockText.match(/,\s*(\d{5})\s+([^|]+)/i);

        /* La capture de la ville court jusqu'au séparateur « | » et
           absorbe les libellés qui suivent (« Mise à jour : … »).
           On tronque sur ces mots-clés, puis on normalise les espaces. */
        function cleanCity(raw) {
          return String(raw || "")
            .split(/\s{2,}/)[0]
            .split(/\s*(?:Mise à jour|Coordonnées|Espace|Ensemble Paroissial|Paroisse)\s*:/i)[0]
            .replace(/[|,;]+$/, "")
            .replace(/\s+/g, " ")
            .trim();
        }
        const coordsMatch = blockText.match(/Coordonnées\s*:\s*(-?[\d,.\s]+)\s*:\s*(-?[\d,.\s]+)/i);
        /* Les captures « [^|]+ » débordent sur le libellé suivant :
           « Ensemble Paroissial : X Espace : Y » renvoyait X + « Espace : Y ».
           On tronque sur le premier libellé rencontré. */
        const LABELS = /\s*(?:Mise à jour|Coordonnées|Espace|Ensemble Paroissial|Paroisse|Horaires de la paroisse)\s*:/i;

        function cleanLabel(raw) {
          return String(raw || "")
            .split(LABELS)[0]
            .replace(/[|,;]+$/, "")
            .replace(/\s+/g, " ")
            .trim();
        }

        const parishMatch = blockText.match(/(?:Ensemble Paroissial|Paroisse)\s*:\s*([^|]+)/i);
        const areaMatch = blockText.match(/Espace\s*:\s*([^|]+)/i);

        // Lien « Horaires de la paroisse » présent dans le bloc
        let parishUrl = "";
        for (const node of blockNodes) {
          const a = [...node.querySelectorAll("a")].find(link =>
            /horaires?\s+de\s+la\s+paroisse|paroisse/i.test(link.textContent || "") ||
            /\/paroisse\//i.test(link.getAttribute("href") || "")
          );
          if (a) {
            try { parishUrl = new URL(a.getAttribute("href"), sourceUrl).href; } catch (e) {}
            break;
          }
        }
        const updateMatch = blockText.match(/Mise à jour\s*:\s*([^|]+)/i);

        let church = churchText;
        let cityFromChurch = "";
        const churchCityMatch = churchText.match(/^(.*?)\s+à\s+(.+)$/i);
        if (churchCityMatch) {
          church = churchCityMatch[1].trim();
          cityFromChurch = churchCityMatch[2].trim();
        }

        const parsedDate = parseFrenchDate(dateLabel);
        const postalCode = String(locationMatch?.[1] || "").trim();
        const city = cleanCity(locationMatch?.[2]) || cleanCity(cityFromChurch);
        const latitude = coordsMatch ? Number(coordsMatch[1].replace(/\s/g, "").replace(",", ".")) : NaN;
        const longitude = coordsMatch ? Number(coordsMatch[2].replace(/\s/g, "").replace(",", ".")) : NaN;

        const detailUrl = churchLink
          ? new URL(churchLink.getAttribute("href"), sourceUrl).href
          : "";

        masses.push({
          dateLabel,
          dateISO: parsedDate.iso,
          timestamp: parsedDate.timestamp,
          day: Number.isFinite(parsedDate.timestamp) ? dayNames[new Date(parsedDate.timestamp).getDay()] : "",
          hour: parsedDate.hour,
          celebration: parsedDate.celebration,
          church,
          city,
          postalCode,
          latitude,
          longitude,
          parish: cleanLabel(parishMatch?.[1]),
          area: cleanLabel(areaMatch?.[1]),
          parishUrl,
          updated: updateMatch?.[1]?.trim() || "",
          detailUrl,
          sourceUrl,
          distanceKm: null
        });
      }

      /* On conserve les célébrations SANS coordonnées : elles seront replacées
         par géocodage (repli) plus tard, plutôt que d'être écartées ici. */
      return masses
        .filter(m => m.church)
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }

    async function fetchWithFallback(url) {
      const strategies = [
        {
          name: "accès direct",
          request: () => fetch(url, {
            headers: { "Accept": "text/html,application/xhtml+xml" }
          })
        },
        {
          name: "proxy AllOrigins",
          request: () => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`)
        },
        {
          name: "proxy corsproxy.io",
          request: () => fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`)
        }
      ];

      const errors = [];
      for (const strategy of strategies) {
        try {
          setStatus(`Chargement par ${strategy.name}…`, "warning");
          const response = await strategy.request();
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const text = await response.text();
          if (!text || text.length < 500) throw new Error("réponse vide ou incomplète");
          return { text, strategy: strategy.name };
        } catch (error) {
          errors.push(`${strategy.name}: ${error.message}`);
        }
      }

      throw new Error(errors.join(" | "));
    }


    /* ============================================================
       SOURCE 1 : API officielle MessesInfo v2 (recommandée)
       GET https://messes.info/api/v2/place/{lat}/{lng}?format=json
       Une userkey peut être demandée à contact.messesinfo@cef.fr
       ============================================================ */

    const API_BASE = "https://messes.info/api/v2";

    function apiUrl(path, params = {}) {
      const url = new URL(`${API_BASE}/${path}`);
      url.searchParams.set("format", "json");
      const key = els.userKey?.value.trim();
      if (key) url.searchParams.set("userkey", key);
      Object.entries(params).forEach(([k, v]) => {
        if (v !== "" && v != null) url.searchParams.set(k, v);
      });
      return url.toString();
    }

    async function fetchJson(url) {
      const attempts = [
        url,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?url=${encodeURIComponent(url)}`
      ];
      let last;
      for (const target of attempts) {
        try {
          const res = await fetch(target, { headers: { Accept: "application/json" } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const txt = await res.text();
          return JSON.parse(txt);
        } catch (e) { last = e; }
      }
      throw last || new Error("Requête impossible");
    }

    function toNum(v) {
      const n = Number(String(v ?? "").replace(",", "."));
      return Number.isFinite(n) ? n : NaN;
    }

    // Normalise un enregistrement de l'API vers le modèle interne
    function mapApiRecord(rec) {
      const place = rec.place || rec.locality || rec;
      const lat = toNum(place.latitude ?? place.lat ?? rec.latitude);
      const lng = toNum(place.longitude ?? place.lng ?? place.lon ?? rec.longitude);

      const rawDate = rec.date || rec.day || "";
      const rawTime = String(rec.time || rec.hour || "").replace("h", ":");
      const ts = rawDate ? new Date(`${rawDate}T${(rawTime || "00:00").padEnd(5, "0")}:00`).getTime() : NaN;

      return {
        dateLabel: rawDate
          ? new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) +
            (rawTime ? ` - ${rawTime}` : "")
          : "",
        dateISO: rawDate || "",
        timestamp: ts,
        day: Number.isFinite(ts) ? dayNames[new Date(ts).getDay()] : "",
        hour: rawTime,
        celebration: rec.celebrationName || rec.celebration || rec.timeType || "",
        church: place.name || place.churchName || rec.name || "",
        city: place.city || place.town || place.localityName || "",
        postalCode: String(place.zipcode || place.postalCode || place.zipCode || ""),
        latitude: lat,
        longitude: lng,
        parish: rec.communityName || rec.community || place.communityName || "",
        area: rec.networkName || rec.network || "",
        updated: rec.updated || rec.lastUpdate || "",
        detailUrl: place.id ? `https://messes.info/lieu/${place.id}` : "",
        parishUrl: rec.communityId ? `https://messes.info/paroisse/${rec.communityId}` : "",
        sourceUrl: "api/v2",
        distanceKm: null
      };
    }

    function collectRecords(payload) {
      if (Array.isArray(payload)) return payload;
      for (const key of ["items", "results", "list", "listCelebrationTime", "masses", "places", "celebrations"]) {
        if (Array.isArray(payload?.[key])) return payload[key];
      }
      const arrays = Object.values(payload || {}).filter(Array.isArray);
      return arrays.length ? arrays.flat() : [];
    }

    async function loadFromApi() {
      const c = currentCoords();
      if (!c) {
        setStatus("Coordonnées invalides dans les réglages.", "error");
        return;
      }
      const { lat, lng } = c;
      const days = Number(els.apiDays.value) || 30;

      setStatus("Interrogation de l'API MessesInfo…", "warning");

      // La ressource exacte varie selon les déploiements : on essaie plusieurs formes
      const candidates = [
        apiUrl(`place/${lat}/${lng}`, { max: 500 }),
        apiUrl("place", { latitude: lat, longitude: lng, max: 500 }),
        apiUrl("mass", { latitude: lat, longitude: lng, max: 500 }),
        apiUrl("horaires", { latitude: lat, longitude: lng, max: 500 })
      ];

      const errors = [];
      for (const url of candidates) {
        try {
          const payload = await fetchJson(url);
          const masses = collectRecords(payload)
            .map(mapApiRecord)
            .filter(m => m.church);

          if (!masses.length) throw new Error("aucun enregistrement exploitable");

          const approx = await fillMissingCoords(masses);
          const geocoded = masses.filter(m => Number.isFinite(m.latitude) && Number.isFinite(m.longitude));
          if (!geocoded.length) throw new Error("aucun enregistrement exploitable");

          const limit = Date.now() + days * 86400000;
          const kept = geocoded.filter(m => !Number.isFinite(m.timestamp) || m.timestamp <= limit);

          setData(kept);
          setStatus(
            `${kept.length} célébration(s) chargée(s) depuis l'API MessesInfo` +
            (approx ? ` — dont ${approx} replacée(s) approximativement.` : "."),
            "success"
          );
          return;
        } catch (e) {
          errors.push(e.message);
        }
      }

      setStatus(
        `API inaccessible (${errors.join(" | ")}). Une userkey est probablement nécessaire : ` +
        `demandez-la à contact.messesinfo@cef.fr. Repli possible sur le chargement HTML.`,
        "error"
      );
    }

    /* ============================================================
       Géocodage : API Adresse (Base Adresse Nationale)
       Service public, gratuit, sans clé, CORS autorisé.
       ============================================================ */

    const BAN_URL = "https://api-adresse.data.gouv.fr/search/";

    /* ------------------------------------------------------------
       Repli de géocodage : certaines célébrations de messes.info
       n'ont pas de coordonnées dans la page « autour d'un point ».
       Plutôt que de les écarter (invisibles sur la carte ET dans la
       liste), on récupère des coordonnées via la Base Adresse
       Nationale — d'abord l'église, sinon le centre de la commune.
       Résultats mis en cache pour limiter les requêtes.
       ------------------------------------------------------------ */
    const geoCache = new Map();

    async function geocodeQuery(q, postcode, type) {
      q = String(q || "").trim();
      if (!q) return null;
      const key = `${type || ""}|${q}|${postcode || ""}`;
      if (geoCache.has(key)) return geoCache.get(key);

      let coords = null;
      try {
        const params = new URLSearchParams({ q, limit: "1" });
        if (postcode) params.set("postcode", String(postcode).trim());
        if (type) params.set("type", type);
        const res = await fetch(`${BAN_URL}?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          const f = data.features && data.features[0];
          const co = f && f.geometry && f.geometry.coordinates;
          if (co && Number.isFinite(co[1]) && Number.isFinite(co[0])) {
            coords = { lat: co[1], lng: co[0] };
          }
        }
      } catch (e) { /* réseau indisponible : on renverra null */ }

      geoCache.set(key, coords);
      return coords;
    }

    async function geocodeCoords(mass) {
      // 1) l'église + la ville (parfois reconnue comme voie/lieu-dit)
      let c = null;
      if (mass.church) c = await geocodeQuery(`${mass.church} ${mass.city || ""}`, mass.postalCode, "");
      // 2) repli fiable : centre de la commune
      if (!c && (mass.city || mass.postalCode)) {
        c = await geocodeQuery(mass.city || mass.postalCode, mass.postalCode, "municipality");
      }
      return c;
    }

    // Complète les coordonnées manquantes ; une requête par lieu unique.
    async function fillMissingCoords(masses) {
      const hasCoords = m => Number.isFinite(m.latitude) && Number.isFinite(m.longitude);
      const missing = masses.filter(m => !hasCoords(m));
      if (!missing.length) return 0;

      const byPlace = new Map();
      missing.forEach(m => {
        const k = `${normalize(m.church)}|${m.postalCode}|${normalize(m.city)}`;
        if (!byPlace.has(k)) byPlace.set(k, []);
        byPlace.get(k).push(m);
      });

      let filled = 0;
      await Promise.all([...byPlace.values()].map(async group => {
        const c = await geocodeCoords(group[0]);
        if (c) group.forEach(m => {
          m.latitude = c.lat;
          m.longitude = c.lng;
          m.approxCoords = true; // position approximative (repli)
          filled++;
        });
      }));
      return filled;
    }

    let suggestItems = [];
    let suggestIndex = -1;

    function hideSuggest() {
      els.placeSuggest.hidden = true;
      els.placeSuggest.innerHTML = "";
      suggestItems = [];
      suggestIndex = -1;
    }

    function renderSuggest() {
      if (!suggestItems.length) return hideSuggest();

      els.placeSuggest.innerHTML = suggestItems.map((f, i) => {
        const p = f.properties;
        const ctx = p.context ? ` <small>(${escapeHtml(p.context)})</small>` : "";
        return `<div data-i="${i}" class="${i === suggestIndex ? "active" : ""}">${escapeHtml(p.label)}${ctx}</div>`;
      }).join("");

      els.placeSuggest.hidden = false;

      els.placeSuggest.querySelectorAll("div[data-i]").forEach(node => {
        node.addEventListener("mousedown", e => {
          e.preventDefault();
          chooseSuggest(Number(node.dataset.i));
        });
      });
    }

    async function searchPlace() {
      const q = els.placeSearch.value.trim();
      if (q.length < 3) return hideSuggest();

      try {
        const res = await fetch(`${BAN_URL}?q=${encodeURIComponent(q)}&limit=7`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        suggestItems = data.features || [];
        suggestIndex = -1;
        renderSuggest();
      } catch (e) {
        hideSuggest();
        setStatus(`Recherche d'adresse indisponible : ${e.message}`, "error");
      }
    }

    /* Lancement de la recherche depuis le bouton « Rechercher » ou la touche
       Entrée : si une suggestion est active on la retient, sinon on géocode
       directement le texte saisi (ville, code postal ou adresse). */
    async function submitPlaceSearch() {
      // Une suggestion est explicitement surlignée : on la choisit
      if (suggestIndex >= 0 && suggestItems[suggestIndex]) {
        return chooseSuggest(suggestIndex);
      }

      const q = els.placeSearch.value.trim();
      if (q.length < 3) {
        setStatus("Saisissez au moins 3 caractères (ville, code postal ou adresse).", "warning");
        els.placeSearch.focus();
        return;
      }

      // Des suggestions sont déjà chargées : on retient la première
      if (suggestItems.length) return chooseSuggest(0);

      try {
        setStatus(`Recherche du lieu « ${q} »…`, "warning");
        const res = await fetch(`${BAN_URL}?q=${encodeURIComponent(q)}&limit=5`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.features || !data.features.length) {
          setStatus(`Aucun lieu trouvé pour « ${q} ». Vérifiez l'orthographe.`, "error");
          return;
        }
        suggestItems = data.features;
        chooseSuggest(0);
      } catch (e) {
        setStatus(`Recherche indisponible : ${e.message}`, "error");
      }
    }

    // Navigation clavier dans la liste de suggestions + soumission
    function handlePlaceKeydown(e) {
      const open = !els.placeSuggest.hidden && suggestItems.length > 0;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!open) return searchPlace();
        suggestIndex = (suggestIndex + 1) % suggestItems.length;
        renderSuggest();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!open) return;
        suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length;
        renderSuggest();
      } else if (e.key === "Enter") {
        e.preventDefault();
        submitPlaceSearch();
      } else if (e.key === "Escape") {
        hideSuggest();
      }
    }

    // Sélection d'un lieu : coordonnées, recentrage, puis chargement automatique
    function chooseSuggest(i) {
      const f = suggestItems[i];
      if (!f) return;

      const [lng, lat] = f.geometry.coordinates;
      els.placeSearch.value = f.properties.label;
      hideSuggest();

      setOrigin(lat, lng, f.properties.label, "address");
      setStatus(`Recherche des messes autour de ${f.properties.label}…`, "warning");
      loadMasses();
    }

    /* ------------------------------------------------------------
       Point de référence unique : adresse saisie OU position GPS.
       Toute origine passe par ici — la dernière définie fait foi.
       ------------------------------------------------------------ */
    function setOrigin(lat, lng, label, kind) {
      state.userPosition = { lat, lng, label, kind };

      els.apiLat.value = lat.toFixed(7);
      els.apiLng.value = lng.toFixed(7);

      updateDistances();
      drawUserMarker();
      map.setView([lat, lng], 12);
      applyFilters();
    }

    function clearOrigin() {
      state.userPosition = null;
      els.placeSearch.value = "";
      if (state.userMarker) { map.removeLayer(state.userMarker); state.userMarker = null; }
      updateDistances();
      applyFilters();
      setStatus("Point de référence effacé. Les distances ne sont plus calculées.", "warning");
    }

    function currentCoords() {
      const lat = Number(String(els.apiLat.value).replace(",", "."));
      const lng = Number(String(els.apiLng.value).replace(",", "."));
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    }

    // URL messes.info construite automatiquement depuis les coordonnées
    function buildSourceUrl(lat, lng) {
      return `https://messes.info/horaires/${lat.toFixed(7)}:${lng.toFixed(7)}`;
    }

    async function loadMasses() {
      const coords = currentCoords();
      if (!coords) {
        setStatus("Choisissez d'abord un lieu ou utilisez « Ma position ».", "error");
        return;
      }

      if (els.sourceMode.value === "api") return loadFromApi();

      const url = buildSourceUrl(coords.lat, coords.lng);
      try {
        const { text, strategy } = await fetchWithFallback(url);
        const masses = parseMessesInfo(text, url);

        if (!masses.length) {
          throw new Error("Aucune célébration exploitable n'a été détectée dans la page.");
        }

        // Repli de géocodage pour les célébrations sans coordonnées
        const needGeo = masses.some(m => !(Number.isFinite(m.latitude) && Number.isFinite(m.longitude)));
        if (needGeo) setStatus("Chargement… géocodage des lieux sans coordonnées.", "warning");
        const approx = await fillMissingCoords(masses);

        const usable = masses.filter(m => Number.isFinite(m.latitude) && Number.isFinite(m.longitude));
        if (!usable.length) {
          throw new Error("Aucune célébration exploitable n'a été détectée dans la page.");
        }

        setData(usable);
        setStatus(
          `${usable.length} célébration(s) chargée(s) par ${strategy}` +
          (approx ? ` — dont ${approx} replacée(s) approximativement (géocodage).` : "."),
          "success"
        );
      } catch (error) {
        console.error(error);
        setStatus(
          `Échec du chargement : ${error.message}. Essayez « Exemple », ou renseignez une userkey ` +
          `dans les réglages pour passer par l'API v2.`,
          "error"
        );
      }
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const toRad = deg => deg * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }

    function updateDistances() {
      if (!state.userPosition) {
        state.masses.forEach(m => m.distanceKm = null);
        return;
      }

      state.masses.forEach(m => {
        m.distanceKm = haversineKm(
          state.userPosition.lat,
          state.userPosition.lng,
          m.latitude,
          m.longitude
        );
      });
    }

    function locateUser() {
      if (!navigator.geolocation) {
        setStatus("La géolocalisation n'est pas prise en charge par ce navigateur.", "error");
        return;
      }

      els.locateBtn.disabled = true;
      setStatus("Recherche de votre position…", "warning");

      navigator.geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude, accuracy } = position.coords;

          setOrigin(
            latitude,
            longitude,
            `Ma position (± ${Math.round(accuracy)} m)`,
            "gps"
          );
          els.placeSearch.value = "";
          els.locateBtn.disabled = false;

          /* MessesInfo ne couvre que la France. Hors zone, le service
             renvoie une page vide : on le signale au lieu de laisser
             croire à un échec de l'application. */
          const inFrance = latitude > 41 && latitude < 51.5
                        && longitude > -5.5 && longitude < 9.8;

          if (!inFrance) {
            setStatus(
              `Position détectée hors de France métropolitaine ` +
              `(${latitude.toFixed(3)}, ${longitude.toFixed(3)}). MessesInfo ne couvre pas cette zone : ` +
              `saisissez une commune française dans le champ de recherche.`,
              "warning"
            );
            return;
          }

          setStatus("Position obtenue, recherche des messes à proximité…", "warning");
          loadMasses();
        },
        error => {
          const messages = {
            1: "Autorisation de géolocalisation refusée.",
            2: "Position indisponible.",
            3: "Délai de géolocalisation dépassé."
          };
          setStatus(messages[error.code] || error.message, "error");
          els.locateBtn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 }
      );
    }

    function drawUserMarker() {
      if (state.userMarker) map.removeLayer(state.userMarker);
      if (!state.userPosition) return;

      state.userMarker = L.circleMarker(
        [state.userPosition.lat, state.userPosition.lng],
        {
          radius: 9,
          weight: 3,
          color: "#ffffff",
          fillColor: "#d12f2f",
          fillOpacity: 1
        }
      )
      .bindPopup("<strong>Votre position</strong>")
      .addTo(map);
    }

    function escapeHtml(value = "") {
      return value.replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]);
    }

    /* Lien « Ajouter à Google Agenda » pour une célébration : URL TEMPLATE de
       Google Calendar (un événement d'1 h). N'ajoute qu'un événement à la fois ;
       pour tout l'agenda, l'export iCal s'importe dans Google Calendar. */
    function googleCalUrl(mass) {
      if (!Number.isFinite(mass.timestamp)) return "";
      const pad = n => String(n).padStart(2, "0");
      const fmt = ts => {
        const d = new Date(ts);
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
               `T${pad(d.getHours())}${pad(d.getMinutes())}00`;
      };
      const start = mass.timestamp;
      const end = start + 60 * 60 * 1000;
      const params = new URLSearchParams({
        action: "TEMPLATE",
        text: `Messe — ${mass.church}`,
        dates: `${fmt(start)}/${fmt(end)}`,
        location: [mass.church, `${mass.postalCode} ${mass.city}`.trim()].filter(Boolean).join(", "),
        details: [
          mass.celebration, mass.parish ? `Paroisse : ${mass.parish}` : "", mass.detailUrl
        ].filter(Boolean).join(" | ")
      });
      return `https://calendar.google.com/calendar/render?${params.toString()}`;
    }

    function markerPopup(mass) {
      const distance = mass.distanceKm == null
        ? ""
        : `<br><b>Distance :</b> ${mass.distanceKm.toFixed(1)} km`;

      const link = mass.detailUrl
        ? `<br><a href="${escapeHtml(mass.detailUrl)}" target="_blank" rel="noopener">Voir la fiche</a>`
        : "";

      const from = state.userPosition
        ? `${state.userPosition.lat},${state.userPosition.lng}`
        : "";
      const itinerary = `<br><a href="https://www.google.com/maps/dir/?api=1&origin=${from}&destination=${mass.latitude},${mass.longitude}" target="_blank" rel="noopener">Itinéraire</a>`;

      return `
        <strong>${escapeHtml(mass.church)}</strong><br>
        ${escapeHtml(displayDate(mass))}<br>
        ${escapeHtml(mass.postalCode)} ${escapeHtml(mass.city)}
        ${distance}${link}${itinerary}
      `;
    }

    function groupPopup(group) {
      const { mass } = group[0];
      const from = state.userPosition ? `${state.userPosition.lat},${state.userPosition.lng}` : "";
      const dist = mass.distanceKm == null ? "" : ` &middot; ${mass.distanceKm.toFixed(1)} km`;
      const fav = isFavorite(mass);
      const favBtn =
        `<button class="popup-fav ${fav ? "active" : ""}" type="button"
                 onclick="window.__toggleFav('${encodeURIComponent(favKey(mass))}')">` +
        `${fav ? "★ Retirer des favoris" : "☆ Ajouter aux favoris"}</button>`;

      const times = group
        .slice()
        .sort((a, b) => (a.mass.timestamp || 0) - (b.mass.timestamp || 0))
        .map(({ mass: m }) => `<li>${escapeHtml(displayDate(m))}${m.celebration ? ` — <i>${escapeHtml(m.celebration)}</i>` : ""}` +
          `${googleCalUrl(m) ? ` &middot; <a href="${escapeHtml(googleCalUrl(m))}" target="_blank" rel="noopener">Google Agenda</a>` : ""}</li>`)
        .join("");

      return `
        <strong>${escapeHtml(mass.church)}</strong><br>
        <span style="color:#687386">${escapeHtml(mass.postalCode)} ${escapeHtml(mass.city)}${dist}</span><br>
        ${favBtn}
        <ul style="margin:8px 0;padding-left:18px;max-height:170px;overflow:auto">${times}</ul>
        ${mass.parishUrl ? `<a href="${escapeHtml(mass.parishUrl)}" target="_blank" rel="noopener">Horaires paroisse</a> &middot; ` : ""}
        ${mass.detailUrl ? `<a href="${escapeHtml(mass.detailUrl)}" target="_blank" rel="noopener">Fiche</a> &middot; ` : ""}
        <a href="https://www.google.com/maps/dir/?api=1&origin=${from}&destination=${mass.latitude},${mass.longitude}"
           target="_blank" rel="noopener">Itinéraire</a>
      `;
    }

    /* Marqueur église : forme allongée (dôme surmonté d'une pointe) portant
       une croix blanche. Doré pour un favori, bleu sinon (plus foncé quand
       le lieu regroupe plusieurs célébrations, avec une pastille du nombre). */
    function churchIcon(count, fav) {
      const w = 30, h = 46;
      const color = fav ? "#e0a100" : (count > 1 ? "#2446b5" : "#3157d5");
      const badge = count > 1
        ? `<div style="position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;
             padding:0 3px;background:#c23b33;color:#fff;border:2px solid #fff;border-radius:999px;
             display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;
             box-shadow:0 1px 3px rgba(0,0,0,.4)">${count}</div>`
        : "";
      const html =
        `<div style="position:relative;width:${w}px;height:${h}px;filter:drop-shadow(0 3px 3px rgba(0,0,0,.35))">
           <svg width="${w}" height="${h}" viewBox="0 0 30 46" xmlns="http://www.w3.org/2000/svg">
             <path d="M15 45 C15 45 27 27 27 15 A12 12 0 1 0 3 15 C3 27 15 45 15 45 Z"
                   fill="${color}" stroke="#ffffff" stroke-width="2"/>
             <rect x="13.2" y="4.5" width="3.6" height="18" rx="1.2" fill="#ffffff"/>
             <rect x="8.5" y="9.5" width="13" height="3.6" rx="1.2" fill="#ffffff"/>
           </svg>${badge}
         </div>`;
      return L.divIcon({ className: "church-marker", html, iconSize: [w, h], iconAnchor: [w / 2, h] });
    }

    /* fitView = true uniquement lors d'un changement de jeu de données.
       Pendant le filtrage, la vue de l'utilisateur est préservée :
       les marqueurs sont mis à jour sans toucher au zoom ni au centre. */
    function renderMap(fitView = false) {
      state.markerLayer.clearLayers();
      state.markers = [];
      state.favLookup.clear();

      // Regroupement : une épingle par lieu, listant toutes ses célébrations
      const byPlace = new Map();
      state.filtered.forEach((mass, index) => {
        const key = `${mass.latitude.toFixed(5)}|${mass.longitude.toFixed(5)}`;
        if (!byPlace.has(key)) byPlace.set(key, []);
        byPlace.get(key).push({ mass, index });
      });

      const bounds = [];
      byPlace.forEach(group => {
        const { mass } = group[0];
        const count = group.length;
        const fav = isFavorite(mass);

        // Permet la bascule du favori depuis le popup de ce lieu
        state.favLookup.set(favKey(mass), mass);

        const icon = churchIcon(count, fav);

        const marker = L.marker([mass.latitude, mass.longitude], { icon })
          .bindPopup(groupPopup(group), { maxWidth: 320 })
          .addTo(state.markerLayer);

        marker.on("click", () => selectCard(group[0].index));

        // Un marqueur référencé pour chaque index de la liste
        group.forEach(({ index }) => { state.markers[index] = marker; });
        bounds.push([mass.latitude, mass.longitude]);
      });

      if (state.userPosition) {
        drawUserMarker();
        bounds.push([state.userPosition.lat, state.userPosition.lng]);
      }

      if (!fitView || !bounds.length) return;

      if (bounds.length === 1) {
        map.setView(bounds[0], 12);
      } else {
        map.fitBounds(bounds, { padding: [35, 35], maxZoom: 13 });
      }
    }

    // Étoile favori réutilisable (idx = index dans state.filtered)
    function favStar(idx, fav) {
      return `<button class="fav-btn ${fav ? "active" : ""}" data-fav="${idx}" data-stop
                 aria-pressed="${fav}" title="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}">${fav ? "★" : "☆"}</button>`;
    }

    // Clé d'un lieu (église) + sa distance (regroupement / tri)
    function placeKey(m) { return `${normalize(m.church)}¦${(m.postalCode || "").trim()}¦${normalize(m.city)}`; }
    function placeDist(m) { return m.distanceKm == null ? Infinity : m.distanceKm; }

    // « Dimanche 26 juillet 2026 » ; heure « 10h30 »
    function dateHeading(m) {
      if (!Number.isFinite(m.timestamp)) return m.dateISO || "Date inconnue";
      const s = new Date(m.timestamp).toLocaleDateString("fr-FR",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    function timeLabel(m) { return (m.hour || "").replace(":", "h"); }

    function itineraryUrl(m) {
      const from = state.userPosition ? `${state.userPosition.lat},${state.userPosition.lng}` : "";
      return `https://www.google.com/maps/dir/?api=1&origin=${from}&destination=${m.latitude},${m.longitude}`;
    }

    // Liens (chips) d'une célébration
    function massLinks(m) {
      return [
        m.parishUrl ? `<a class="chip" data-stop href="${escapeHtml(m.parishUrl)}" target="_blank" rel="noopener">Horaires de la paroisse</a>` : "",
        m.detailUrl ? `<a class="chip" data-stop href="${escapeHtml(m.detailUrl)}" target="_blank" rel="noopener">Fiche du lieu</a>` : "",
        `<a class="chip" data-stop target="_blank" rel="noopener" href="${itineraryUrl(m)}">Itinéraire</a>`,
        googleCalUrl(m) ? `<a class="chip" data-stop href="${escapeHtml(googleCalUrl(m))}" target="_blank" rel="noopener">Google Agenda</a>` : ""
      ].filter(Boolean).join("");
    }

    // Groupes d'accordéon actuellement ouverts (pour préserver l'état au re-rendu)
    function openGroupKeys() {
      return new Set([...els.results.querySelectorAll("details.grp[open]")].map(d => d.dataset.gkey));
    }

    // Écouteurs communs à toutes les vues (favoris, liens, sélection)
    function wireResultListeners() {
      els.results.querySelectorAll("a[data-stop]").forEach(a =>
        a.addEventListener("click", e => e.stopPropagation()));

      els.results.querySelectorAll(".fav-btn").forEach(btn =>
        btn.addEventListener("click", e => {
          e.preventDefault(); e.stopPropagation();
          toggleFavorite(state.filtered[Number(btn.dataset.fav)]);
        }));

      els.results.querySelectorAll(".mass-card, .grp-row").forEach(el => {
        const go = () => selectCard(Number(el.dataset.index));
        el.addEventListener("click", go);
        el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      });
    }

    // Aiguillage selon le tri choisi
    function renderList() {
      if (!state.filtered.length) {
        els.results.innerHTML = '<div class="empty">Aucune célébration ne correspond aux filtres.</div>';
        if (els.moreBtn) els.moreBtn.style.display = "none";
        return;
      }
      const sortBy = els.sortBy ? els.sortBy.value : "auto";
      if (sortBy === "date") renderByDate();
      else if (sortBy === "city") renderByPlace();
      else renderFlat();
    }

    // Vue « à plat » (tri Automatique / Distance)
    function renderFlat() {
      const slice = state.filtered.slice(0, state.shown);
      els.results.innerHTML = slice.map((m, index) => {
        const distance = m.distanceKm == null ? "" : `<span class="distance">${m.distanceKm.toFixed(1)} km</span>`;
        const extra = [
          m.parish ? `Paroisse : ${escapeHtml(m.parish)}` : "",
          m.area ? `Espace : ${escapeHtml(m.area)}` : "",
          m.updated ? `Mise à jour : ${escapeHtml(m.updated)}` : "",
          m.approxCoords ? "📍 Position approximative (commune)" : ""
        ].filter(Boolean).join("<br>");
        return `
          <article class="mass-card" data-index="${index}" tabindex="0" role="button"
                   aria-label="${escapeHtml(m.church)} ${escapeHtml(m.city)} ${escapeHtml(displayDate(m))}">
            <div class="mass-top">
              <div>
                <div class="date">${escapeHtml(displayDate(m))}</div>
                <div class="church">${escapeHtml(m.church)}</div>
              </div>
              <div class="mass-actions">${favStar(index, isFavorite(m))}${distance}</div>
            </div>
            <div class="place">${escapeHtml(m.postalCode)} ${escapeHtml(m.city)}</div>
            <div class="meta">${extra}</div>
            <div class="chips">${massLinks(m)}</div>
          </article>`;
      }).join("");
      wireResultListeners();
      if (els.moreBtn) {
        const rest = state.filtered.length - slice.length;
        els.moreBtn.style.display = rest > 0 ? "" : "none";
        els.moreBtn.textContent = `Afficher ${Math.min(rest, state.pageSize)} de plus (${rest} restantes)`;
      }
    }

    // Vue « par date » : un accordéon par jour, lieux triés par distance
    function renderByDate() {
      const openSet = openGroupKeys();
      const groups = new Map();
      state.filtered.forEach((m, idx) => {
        const key = m.dateISO || (Number.isFinite(m.timestamp) ? String(m.timestamp) : "?");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ m, idx });
      });
      const keys = [...groups.keys()].sort((a, b) =>
        (groups.get(a)[0].m.timestamp || 0) - (groups.get(b)[0].m.timestamp || 0));

      els.results.innerHTML = keys.map((k, gi) => {
        const items = groups.get(k);
        const byPlace = new Map();
        items.forEach(it => {
          const pk = placeKey(it.m);
          if (!byPlace.has(pk)) byPlace.set(pk, []);
          byPlace.get(pk).push(it);
        });
        const lieux = [...byPlace.values()].sort((a, b) =>
          placeDist(a[0].m) - placeDist(b[0].m) || a[0].m.church.localeCompare(b[0].m.church, "fr"));

        const rows = lieux.map(group => {
          const m = group[0].m;
          const idx = group[0].idx;
          const times = group.slice().sort((a, b) => (a.m.timestamp || 0) - (b.m.timestamp || 0))
            .map(it => escapeHtml(timeLabel(it.m))).filter(Boolean).join(" · ");
          const dist = m.distanceKm == null ? "" : `<span class="distance">${m.distanceKm.toFixed(1)} km</span>`;
          return `<div class="grp-row" data-index="${idx}" role="button" tabindex="0">
              <div class="grp-row-main">
                <div class="grp-church">${escapeHtml(m.church)} ${favStar(idx, isFavorite(m))}</div>
                <div class="place">${escapeHtml(m.postalCode)} ${escapeHtml(m.city)}</div>
                ${times ? `<div class="grp-times">${times}</div>` : ""}
              </div>
              ${dist}
            </div>`;
        }).join("");

        const open = openSet.has(k) || (openSet.size === 0 && gi === 0);
        return `<details class="grp" data-gkey="${escapeHtml(k)}"${open ? " open" : ""}>
            <summary class="grp-sum">
              <span class="grp-title">${escapeHtml(dateHeading(items[0].m))}</span>
              <span class="grp-count">${lieux.length} lieu${lieux.length > 1 ? "x" : ""}</span>
            </summary>
            ${rows}
          </details>`;
      }).join("");

      wireResultListeners();
      if (els.moreBtn) els.moreBtn.style.display = "none";
    }

    // Vue « par lieu » : un accordéon par église (triée par distance), avec ses dates
    function renderByPlace() {
      const openSet = openGroupKeys();
      const groups = new Map();
      state.filtered.forEach((m, idx) => {
        const pk = placeKey(m);
        if (!groups.has(pk)) groups.set(pk, []);
        groups.get(pk).push({ m, idx });
      });
      const lieux = [...groups.entries()].sort((a, b) =>
        placeDist(a[1][0].m) - placeDist(b[1][0].m) || a[1][0].m.church.localeCompare(b[1][0].m.church, "fr"));

      els.results.innerHTML = lieux.map(([pk, items], gi) => {
        const m = items[0].m;
        const dist = m.distanceKm == null ? "" : `<span class="distance">${m.distanceKm.toFixed(1)} km</span>`;
        const rows = items.slice().sort((a, b) => (a.m.timestamp || 0) - (b.m.timestamp || 0)).map(it => {
          const mm = it.m;
          const g = googleCalUrl(mm);
          return `<div class="grp-row" data-index="${it.idx}" role="button" tabindex="0">
              <div class="grp-date">${escapeHtml(displayDate(mm))}${mm.celebration ? ` <span class="cd-cel">${escapeHtml(mm.celebration)}</span>` : ""}</div>
              ${g ? `<a class="chip" data-stop href="${escapeHtml(g)}" target="_blank" rel="noopener">+ Agenda</a>` : ""}
            </div>`;
        }).join("");

        const open = openSet.has(pk) || (openSet.size === 0 && gi === 0);
        return `<details class="grp" data-gkey="${escapeHtml(pk)}"${open ? " open" : ""}>
            <summary class="grp-sum">
              <span class="grp-title">
                <span class="grp-church">${escapeHtml(m.church)} ${favStar(items[0].idx, isFavorite(m))}</span>
                <span class="place">${escapeHtml(m.postalCode)} ${escapeHtml(m.city)} · ${items.length} date${items.length > 1 ? "s" : ""}</span>
              </span>
              ${dist}
            </summary>
            ${rows}
          </details>`;
      }).join("");

      wireResultListeners();
      if (els.moreBtn) els.moreBtn.style.display = "none";
    }

    /* Toutes les célébrations à venir du même lieu (même église), triées
       par date. Basé sur state.masses (jeu complet) et non sur la liste
       filtrée : on montre l'agenda réel du lieu sélectionné. */
    function upcomingMassesFor(mass) {
      if (!mass) return [];
      const now = Date.now();
      const key = `${mass.latitude.toFixed(5)}|${mass.longitude.toFixed(5)}`;
      return state.masses
        .filter(m => `${m.latitude.toFixed(5)}|${m.longitude.toFixed(5)}` === key)
        .filter(m => !Number.isFinite(m.timestamp) || m.timestamp >= now - 3600000)
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }

    // Panneau de détail : église sélectionnée + ses prochaines messes
    /* ------------------------------------------------------------
       Fiche église : récupération de la page messes.info du lieu pour
       afficher sa photo et ses horaires habituels (dont les messes de
       semaine, ex. 7h, absentes de la liste « autour d'un point »).
       Lecteur tolérant + repli gracieux ; résultats mis en cache.
       ------------------------------------------------------------ */
    async function fetchHtmlQuiet(url) {
      const targets = [
        url,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`
      ];
      for (const t of targets) {
        try {
          const res = await fetch(t, { headers: { Accept: "text/html" } });
          if (!res.ok) continue;
          const text = await res.text();
          if (text && text.length > 300) return text;
        } catch (e) { /* on tente la stratégie suivante */ }
      }
      return null;
    }

    // Extraction « best effort » des horaires : lignes commençant par HHhMM
    function parseFicheSchedule(doc) {
      const out = [];
      const seen = new Set();
      const nodes = doc.querySelectorAll("li, tr, td, p, div, span");
      for (const n of nodes) {
        if (n.children.length > 2) continue; // ignore les gros conteneurs
        const txt = (n.textContent || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
        if (txt.length > 70) continue;
        const m = txt.match(/^(\d{1,2})h(\d{2})\b(.*)$/);
        if (!m) continue;
        const time = `${m[1].padStart(2, "0")}h${m[2]}`;
        const label = (m[3] || "")
          .replace(/\b\d+\s*min\b/i, "")
          .replace(/[|–—•]+/g, " ")
          .replace(/^[\s:–-]+/, "")
          .replace(/\s+/g, " ")
          .trim();
        const key = `${time}|${label.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ time, label });
        if (out.length >= 40) break;
      }
      return out;
    }

    function parseFiche(html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      // On ne récupère que les horaires : la photo des fiches messes.info est
      // chargée par JavaScript (absente du HTML), donc non extractible ici.
      return { schedule: parseFicheSchedule(doc), loading: false, fetched: true };
    }

    async function loadFiche(mass) {
      const url = mass && mass.detailUrl;
      if (!url || state.detailCache.has(url)) return;
      state.detailCache.set(url, { loading: true, schedule: [], fetched: false });
      const html = await fetchHtmlQuiet(url);
      state.detailCache.set(url, html ? parseFiche(html) : { loading: false, schedule: [], fetched: false });
      // Rafraîchit si le panneau montre toujours cette église
      if (state.detailMass && state.detailMass.detailUrl === url) renderChurchDetail(state.detailMass);
    }

    function renderChurchDetail(mass) {
      if (!els.churchDetail) return;
      state.detailMass = mass || null;
      if (!mass) { els.churchDetail.hidden = true; els.churchDetail.innerHTML = ""; return; }

      const list = upcomingMassesFor(mass);
      const fav = isFavorite(mass);
      const dist = mass.distanceKm == null ? "" : ` &middot; ${mass.distanceKm.toFixed(1)} km`;

      const items = list.length
        ? list.slice(0, 40).map(m => `
            <li>
              <span class="cd-date">${escapeHtml(displayDate(m))}</span>
              ${m.celebration ? `<span class="cd-cel">${escapeHtml(m.celebration)}</span>` : ""}
              ${googleCalUrl(m) ? `<a class="cd-gcal" href="${escapeHtml(googleCalUrl(m))}" target="_blank" rel="noopener" title="Ajouter à Google Agenda">+ Agenda</a>` : ""}
            </li>`).join("")
        : `<li class="cd-empty">Aucune messe à venir référencée pour ce lieu.</li>`;

      const from = state.userPosition ? `${state.userPosition.lat},${state.userPosition.lng}` : "";

      // Données de la fiche messes.info (horaires habituels), si récupérées
      const fiche = mass.detailUrl ? state.detailCache.get(mass.detailUrl) : null;

      let ficheHtml = "";
      if (fiche && fiche.loading) {
        ficheHtml = `<div class="cd-fiche-load">Récupération des horaires (fiche)…</div>`;
      } else if (fiche && fiche.schedule && fiche.schedule.length) {
        ficheHtml =
          `<div class="cd-title">Horaires habituels (fiche)</div>
           <ul class="cd-list">${fiche.schedule.map(s => `
             <li><span class="cd-date">${escapeHtml(s.time)}</span>${s.label
               ? `<span class="cd-cel">${escapeHtml(s.label)}</span>` : ""}</li>`).join("")}</ul>`;
      } else if (fiche && fiche.fetched === false) {
        ficheHtml = `<div class="cd-fiche-load">Fiche messes.info indisponible pour le moment (proxy/réseau). Réessayez plus tard ou ouvrez « Fiche complète ».</div>`;
      }

      els.churchDetail.innerHTML = `
        <div class="cd-head">
          <div>
            <div class="cd-church">${escapeHtml(mass.church)}</div>
            <div class="cd-place">${escapeHtml(mass.postalCode)} ${escapeHtml(mass.city)}${dist}</div>
          </div>
          <div class="cd-actions">
            <button class="fav-btn ${fav ? "active" : ""}" id="cdFav" aria-pressed="${fav}"
                    title="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}">${fav ? "★" : "☆"}</button>
            <button class="cd-close" id="cdClose" title="Fermer">✕</button>
          </div>
        </div>
        <div class="cd-title">Prochaines messes${list.length ? ` (${list.length})` : ""}</div>
        <ul class="cd-list">${items}</ul>
        ${ficheHtml}
        <div class="cd-links">
          ${mass.parishUrl ? `<a class="chip" href="${escapeHtml(mass.parishUrl)}" target="_blank" rel="noopener">Horaires de la paroisse</a>` : ""}
          ${mass.detailUrl ? `<a class="chip" href="${escapeHtml(mass.detailUrl)}" target="_blank" rel="noopener">Fiche complète</a>` : ""}
          <a class="chip" href="https://www.google.com/maps/dir/?api=1&origin=${from}&destination=${mass.latitude},${mass.longitude}" target="_blank" rel="noopener">Itinéraire</a>
        </div>
      `;
      els.churchDetail.hidden = false;

      els.churchDetail.querySelector("#cdClose")?.addEventListener("click", () => renderChurchDetail(null));
      els.churchDetail.querySelector("#cdFav")?.addEventListener("click", () => toggleFavorite(mass));

      // Récupère la fiche (photo + horaires) une seule fois, en arrière-plan
      if (mass.detailUrl && !state.detailCache.has(mass.detailUrl)) loadFiche(mass);
    }

    function selectCard(index) {
      state.selectedIndex = index;
      // Surlignage par correspondance de data-index (marche à plat ET en accordéon)
      els.results.querySelectorAll("[data-index]").forEach(el => {
        el.classList.toggle("selected", Number(el.dataset.index) === index);
      });

      const marker = state.markers[index];
      const mass = state.filtered[index];
      if (marker && mass) {
        renderChurchDetail(mass);
        map.setView([mass.latitude, mass.longitude], Math.max(map.getZoom(), 14));
        marker.openPopup();
        const el = els.results.querySelector(`[data-index="${index}"]`);
        if (el) {
          const grp = el.closest("details.grp");
          if (grp && !grp.open) grp.open = true; // déplie l'accordéon contenant
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    }

    function populateSelect(select, values, label) {
      const current = select.value;
      select.innerHTML = `<option value="">${label}</option>` +
        values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
      if (values.includes(current)) select.value = current;
    }

    function rebuildFilterOptions() {
      const cities = [...new Set(state.masses.map(m => m.city).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "fr"));
      const postalCodes = [...new Set(state.masses.map(m => m.postalCode).filter(Boolean))]
        .sort();
      const days = [...new Set(state.masses.map(m => m.day).filter(Boolean))]
        .sort((a, b) => dayNames.indexOf(a) - dayNames.indexOf(b));

      populateSelect(els.cityFilter, cities, "Toutes");
      populateSelect(els.postalFilter, postalCodes, "Tous");
      populateSelect(els.dayFilter, days, "Tous");
    }

    function applyFilters(fitView = false) {
      const search = normalize(els.textSearch.value);
      const city = els.cityFilter.value;
      const postal = els.postalFilter.value;
      const day = els.dayFilter.value;
      const from = els.dateFrom.value;
      const maxDistance = Number(els.maxDistance.value);
      const sortBy = els.sortBy ? els.sortBy.value : "auto";
      const onlyFuture = els.onlyFuture ? els.onlyFuture.checked : false;
      const onlyFav = els.onlyFav ? els.onlyFav.checked : false;
      const now = Date.now();

      state.filtered = state.masses.filter(m => {
        const haystack = normalize([
          m.church, m.city, m.postalCode, m.parish,
          m.area, displayDate(m), m.celebration
        ].join(" "));

        if (search && !haystack.includes(search)) return false;
        // Comparaison normalisée : insensible à la casse, aux accents et aux espaces
        if (city && normalize(m.city) !== normalize(city)) return false;
        if (postal && String(m.postalCode).trim() !== String(postal).trim()) return false;
        if (day && normalize(m.day) !== normalize(day)) return false;
        if (from && m.dateISO && m.dateISO < from) return false;
        if (onlyFuture && Number.isFinite(m.timestamp) && m.timestamp < now) return false;
        if (onlyFav && !isFavorite(m)) return false;

        if (Number.isFinite(maxDistance) && maxDistance > 0) {
          if (m.distanceKm == null || m.distanceKm > maxDistance) return false;
        }

        return true;
      });

      const byDate = (a, b) => (a.timestamp || 0) - (b.timestamp || 0);
      const byDist = (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || byDate(a, b);

      if (sortBy === "date") state.filtered.sort(byDate);
      else if (sortBy === "distance") state.filtered.sort(byDist);
      else if (sortBy === "city") state.filtered.sort((a, b) => a.city.localeCompare(b.city, "fr") || byDate(a, b));
      else state.filtered.sort(state.userPosition ? byDist : byDate);

      state.shown = state.pageSize;

      if (state.masses.length && !state.filtered.length) {
        setStatus("Aucun résultat pour ces critères. Cliquez sur « Réinitialiser ».", "warning");
      }

      updateMetrics();
      renderList();
      renderMap(fitView);
      // Garde le panneau de détail synchronisé (favori, distance…) s'il est ouvert
      if (state.detailMass) renderChurchDetail(state.detailMass);
      saveSession();
    }

    function updateMetrics() {
      els.totalCount.textContent = state.masses.length;
      els.visibleCount.textContent = state.filtered.length;
      els.cityCount.textContent = new Set(state.masses.map(m => m.city)).size;

      const nearest = state.filtered
        .filter(m => m.distanceKm != null)
        .sort((a, b) => a.distanceKm - b.distanceKm)[0];

      els.nearestValue.textContent = nearest ? `${nearest.distanceKm.toFixed(1)} km` : "—";
    }

    /* Dédoublonnage : messes.info liste parfois deux fois la même célébration
       au même endroit et au même horaire (parfois avec un intitulé ou un code
       postal légèrement différent). On fusionne sur église + ville + date/heure
       et on conserve l'entrée la plus complète (intitulé, paroisse, coordonnées
       exactes, liens). */
    function massRichness(m) {
      return (m.celebration ? 1 : 0) +
             (m.parish ? 1 : 0) +
             (m.area ? 1 : 0) +
             (m.detailUrl ? 1 : 0) +
             (m.parishUrl ? 1 : 0) +
             ((Number.isFinite(m.latitude) && Number.isFinite(m.longitude) && !m.approxCoords) ? 1 : 0);
    }

    function dedupeMasses(masses) {
      const index = new Map(); // clé -> position dans out
      const out = [];
      for (const m of masses) {
        const key = [
          normalize(m.church),
          normalize(m.city),
          Number.isFinite(m.timestamp) ? m.timestamp : `${m.dateISO || ""}|${m.hour || ""}`
        ].join("¦");

        if (!index.has(key)) {
          index.set(key, out.length);
          out.push(m);
        } else {
          const pos = index.get(key);
          if (massRichness(m) > massRichness(out[pos])) out[pos] = m; // garde le plus complet
        }
      }
      return out;
    }

    // « Horaires récupérés le 21 juillet 2026 à 22:15. »
    function updateRefreshInfo() {
      if (!els.refreshInfo) return;
      const ts = state.loadedAt;
      if (!Number.isFinite(ts)) { els.refreshInfo.hidden = true; els.refreshInfo.textContent = ""; return; }
      const d = new Date(ts);
      const date = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
      const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      els.refreshInfo.textContent = `Horaires récupérés le ${date} à ${time}.`;
      els.refreshInfo.hidden = false;
    }

    function setData(masses) {
      masses = dedupeMasses(masses);
      state.masses = masses;
      state.loadedAt = Date.now();
      updateRefreshInfo();
      state.selectedIndex = null;
      renderChurchDetail(null);
      updateDistances();

      /* Les valeurs des filtres ne sont connues qu'APRÈS le chargement.
         On mémorise la sélection courante, on reconstruit les listes à
         partir des nouvelles données, puis on ne restaure que ce qui
         existe encore — un filtre devenu obsolète est abandonné plutôt
         que de vider silencieusement la liste. */
      const previous = {
        city: els.cityFilter.value,
        postal: els.postalFilter.value,
        day: els.dayFilter.value
      };

      rebuildFilterOptions();

      const keep = (select, value) =>
        select.value = [...select.options].some(o => o.value === value) ? value : "";

      const dropped = [];
      if (previous.city && keep(els.cityFilter, previous.city) === "") dropped.push(previous.city);
      if (previous.postal && keep(els.postalFilter, previous.postal) === "") dropped.push(previous.postal);
      if (previous.day && keep(els.dayFilter, previous.day) === "") dropped.push(previous.day);

      applyFilters(true);

      if (dropped.length) {
        setStatus(`Filtre(s) sans équivalent dans les nouvelles données, ignoré(s) : ${dropped.join(", ")}.`, "warning");
      }
    }

    function resetFilters() {
      els.textSearch.value = "";
      els.cityFilter.value = "";
      els.postalFilter.value = "";
      els.dayFilter.value = "";
      els.dateFrom.value = "";
      els.maxDistance.value = "";
      els.sortBy.value = "date";
      els.onlyFuture.checked = false;
      if (els.onlyFav) els.onlyFav.checked = false;
      applyFilters(true);
    }

    function exportCsv() {
      if (!state.filtered.length) {
        setStatus("Aucune donnée à exporter.", "warning");
        return;
      }

      const headers = [
        "jour", "jour_court", "date", "heure", "celebration", "eglise", "code_postal",
        "ville", "latitude", "longitude", "distance_km",
        "ensemble_paroissial", "espace", "mise_a_jour", "url", "url_paroisse"
      ];

      const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const rows = state.filtered.map(m => [
        m.day,
        Number.isFinite(m.timestamp) ? dayShort[new Date(m.timestamp).getDay()] : "",
        m.dateISO, m.hour, m.celebration, m.church, m.postalCode,
        m.city, m.latitude, m.longitude,
        m.distanceKm == null ? "" : m.distanceKm.toFixed(2),
        m.parish, m.area, m.updated, m.detailUrl, m.parishUrl
      ].map(quote).join(";"));

      const csv = "\uFEFF" + headers.join(";") + "\n" + rows.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `messes_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    }

    // Export iCal (.ics) : une entrée d'agenda d'1 h par célébration datée
    function exportIcs() {
      if (!state.filtered.length) {
        setStatus("Aucune donnée à exporter.", "warning");
        return;
      }

      const pad = n => String(n).padStart(2, "0");
      const stamp = ts => {
        const d = new Date(ts);
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
               `T${pad(d.getHours())}${pad(d.getMinutes())}00`;
      };
      const esc = s => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");

      const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Messe-info-app//FR//", "CALSCALE:GREGORIAN"];
      state.filtered.forEach((m, i) => {
        if (!Number.isFinite(m.timestamp)) return;
        const start = m.timestamp;
        const end = start + 60 * 60 * 1000;
        const loc = [m.church, `${m.postalCode} ${m.city}`.trim()].filter(Boolean).join(", ");
        const desc = [
          m.celebration, m.parish ? `Paroisse : ${m.parish}` : "", m.detailUrl
        ].filter(Boolean).join(" | ");
        lines.push(
          "BEGIN:VEVENT",
          `UID:messe-${i}-${start}@messe-info-app`,
          `DTSTART:${stamp(start)}`,
          `DTEND:${stamp(end)}`,
          `SUMMARY:${esc(`Messe — ${m.church}`)}`,
          `LOCATION:${esc(loc)}`
        );
        if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
        lines.push("END:VEVENT");
      });
      lines.push("END:VCALENDAR");

      const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `messes_${new Date().toISOString().slice(0, 10)}.ics`;
      link.click();
      URL.revokeObjectURL(link.href);
    }

    els.locateBtn.addEventListener("click", locateUser);
    els.resetBtn.addEventListener("click", resetFilters);
    els.csvBtn.addEventListener("click", exportCsv);
    els.icsBtn.addEventListener("click", exportIcs);

    /* Champ de recherche de lieu : les suggestions s'affichent pendant la
       frappe ; on choisit un lieu dans la liste (ou on valide avec Entrée).
       La croix efface le champ. */
    function updatePlaceClear() { if (els.placeClear) els.placeClear.hidden = !els.placeSearch.value; }
    els.placeSearch.addEventListener("input", debounce(searchPlace, 250));
    els.placeSearch.addEventListener("input", updatePlaceClear);
    els.placeSearch.addEventListener("keydown", handlePlaceKeydown);
    els.placeSearch.addEventListener("focus", () => { if (suggestItems.length) renderSuggest(); });
    els.placeSearch.addEventListener("blur", () => setTimeout(hideSuggest, 150));
    els.placeClear.addEventListener("click", () => {
      els.placeSearch.value = "";
      hideSuggest();
      updatePlaceClear();
      els.placeSearch.focus();
    });

    const debouncedFilters = debounce(applyFilters, 200);

    // Champ texte : rafraîchissement différé pendant la frappe,
    // immédiat sur Entrée ou sur effacement via la croix native.
    els.textSearch.addEventListener("input", debouncedFilters);
    els.textSearch.addEventListener("search", applyFilters);
    els.textSearch.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); applyFilters(); }
      if (e.key === "Escape") { els.textSearch.value = ""; applyFilters(); }
    });

    // Selects, dates et cases à cocher : rafraîchissement immédiat.
    [
      els.cityFilter, els.postalFilter, els.dayFilter,
      els.dateFrom, els.maxDistance, els.sortBy, els.onlyFuture, els.onlyFav
    ].forEach(element => element.addEventListener("change", applyFilters));

    window.addEventListener("resize", debounce(() => map.invalidateSize(), 200));

    setTimeout(() => map.invalidateSize(), 100);
    restoreSession();
    renderFavPanel();
    updatePlaceClear();

/* ---- PWA (service worker + invite d'installation) ---- */
// PWA : enregistrement du service worker + invite d'installation
    (function () {
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
          navigator.serviceWorker.register("./sw.js").catch(function () {});
        });
      }

      var deferredPrompt = null;
      var installBtn = document.getElementById("installBtn");

      window.addEventListener("beforeinstallprompt", function (e) {
        e.preventDefault();
        deferredPrompt = e;
        if (installBtn) installBtn.hidden = false;
      });

      if (installBtn) {
        installBtn.addEventListener("click", function () {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          Promise.resolve(deferredPrompt.userChoice).finally(function () {
            deferredPrompt = null;
            installBtn.hidden = true;
          });
        });
      }

      window.addEventListener("appinstalled", function () {
        deferredPrompt = null;
        if (installBtn) installBtn.hidden = true;
      });
    })();
