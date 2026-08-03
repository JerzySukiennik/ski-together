# SKI Together — specyfikacja

Ustalona w wywiadzie `/pytania`, 2026-08-02. Wszystko poniżej to decyzje Jurka, nie propozycje.

---

## 1. Czym jest ta gra

Sieciowa gra 3D w przeglądarce (2–5 osób) o wspólnym spędzaniu dnia w ośrodku narciarskim.
Wypożyczasz sprzęt, przebierasz się, jedziesz wyciągiem, zjeżdżasz, skaczesz, wywracasz się,
zbierasz punkty i wydajesz je w kafejce. Śnieg pod tobą jest prawdziwym, zmieniającym się
materiałem — i to on jest sercem gry.

Hosting: **GitHub Pages** (statyczny, bez serwera). Repo publiczne `ski-together`.
Język interfejsu: **angielski**. Sterowanie: **klawiatura + mysz, bez pada**.

---

## 2. Rdzeń rozgrywki

### Zjazd (sedno gry)
- Grawitacja i technika. Prędkość bierze się z nachylenia stoku i z tego, jak mało skręcasz.
- `A`/`D` — przechylenie na krawędź. Im dłużej trzymasz, tym ostrzejszy łuk.
- `S` — pług / hamowanie krawędzią, ścina prędkość.
- `Shift` — zejście do śmigu na wprost (maksymalna prędkość, minimalna kontrola).
- `Spacja` — wybicie.
- Mysz — kamera (TPP za plecami, odsuwa się przy prędkości, wolny obrót).
- Snowboard: ta sama logika, ale krawędź przednia/tylna, możliwa jazda switch (tyłem).

### Ruch o własnych siłach
- `W` na płaskim i pod górę = automatyczna jodełka (V-krok) na nartach / odpychanie nogą na desce.
  Animacja robi się sama, gracz nie wystukuje rytmu.
- Marsz pieszo w butach: zapadanie zależne od stanu śniegu — po ubitej trasie prawie normalnie
  (płytkie ślady butów), w puchu po kolana (ledwo brniesz, głęboka dziura), na lodzie ślizgasz się
  i możesz upaść.

### Triki
- W powietrzu: obroty w dwóch osiach (pion + salto), przytrzymanie klawisza = chwyt za nartę/deskę.
- Punkty za kąt obrotu, wysokość i **czystość lądowania**. Lądowanie bokiem = wywrotka, seria kasowana.

### Upadki — pełna komedia
- Ragdoll: ciało koziołkuje po zboczu, hamuje, wstaje.
- **Sprzęt odpada** przy kraksie. Narta/deska/kask lecą osobno, zatrzymują się w zasięgu ~10–15 m,
  delikatnie świecą, żeby dało się je znaleźć w śniegu. Idziesz po nie pieszo w butach
  (i wtedy czujesz, czym jest chodzenie po śniegu), zakładasz, jedziesz dalej. Kara: 10–15 s.
- Kolega może podnieść i przynieść cudzy sprzęt.
- Gracze **zderzają się ze sobą** — wjazd z impetem wywraca obu i obu rozsypuje sprzęt.

---

## 3. Śnieg — najważniejszy system

### Reprezentacja
Cały stok pokryty siatką komórek co **~0,5 m**. Każda komórka pamięta:
- **stan**: świeżo wyratrakowany → przejechany → wyślizgany → lodowy (odkryta trawa/kamień),
  osobno: głęboki puch (poza trasą),
- **głębokość / deformację** — jazda naprawdę wcina rowek w geometrię terenu.

Stan komórki steruje fizyką: tarciem ślizgu, przyczepnością krawędzi, oporem przy chodzeniu.
To jedno rozwiązanie obsługuje wszystko naraz: ratrak, zużycie, chodzenie w butach, puch poza trasą.

### Zużycie
- Każdy przejazd zabiera trochę śniegu z komórki. Popularne linie psują się najszybciej,
  więc gracze sami zaczynają szukać świeżych.
- **Brak samoistnej regeneracji.** Jedyny sposób odnowy to ratrak.
- Ślady żyją **do końca sesji albo do przejazdu ratraka**. Po godzinie stok opowiada historię wieczoru.

### Poza trasą
Śnieg głęboki i nieratrakowany: jedzie się wolniej i ciężej, ale **to tam są skróty, ukryte skoki
i więcej punktów za ryzyko**. Las jest twardy i kolizyjny (wjazd w drzewo = ragdoll + zgubiony sprzęt),
ale nie punktowany — drzewa są po to, żeby ich unikać.

### Śnieg w sieci
**Host trzyma prawdę.** Kilkadziesiąt razy na sekundę rozsyła tylko komórki, które się zmieniły
(kilkaset bajtów). Nowy gracz przy wejściu dostaje jedną spakowaną migawkę całego stoku.
Wszyscy widzą te same koleiny i ten sam sztruks po ratraku.

---

## 4. Góra

- **Jedna góra, trzy trasy** rozchodzące się ze szczytu i zbiegające na dole przy stacji:
  - niebieska — łagodna, dużo miejsca,
  - czerwona — stroma, skocznie i przeszkody,
  - czarna — bardzo stroma, muldy, wąskie przejścia.
- Skala: **jeden zjazd ~90 sekund, przewyższenie ~250 m**.
- Przeszkody na trasach: **skocznie i hopki** różnej wielkości, **bramki slalomowe i tyczki**
  (punkty za serię bez pudła), **rury i barierki do ślizgu** (snowpark).
- **Ośla łączka** przy dolnej stacji: mały łagodny stok, wejście pieszo w 10 s, tabliczki
  z podpowiedziami sterowania stojące w świecie, nie na ekranie. Tam uczysz się hamować.

## 5. Wyciągi

- **Orczyk** (wyciąg talerzykowy) na łatwą trasę — trzymasz drążek, suniesz na nartach po śladzie,
  przy złym najeździe można się wywalić. Jedzie się pojedynczo.
- **Krzesełko pięcioosobowe** na szczyt — cała ekipa obok siebie, barierka opada, nogi z nartami dyndają.
- Przejazd **na żywo, ~40 s**, kamera wolna: widzisz cały stok z góry, kto gdzie jeździ,
  gdzie śnieg jest już wyślizgany, którędy poprowadzić następną linię.
- **Bez kompletu nie wpuszczają na wyciąg**: potrzebny kask i buty pasujące do sprzętu
  (buty narciarskie nie wejdą w wiązania deski i odwrotnie).

## 6. Ratrak

- **Jeden ratrak** przy dolnej stacji, kto pierwszy ten lepszy. Wyjeżdża z garażu.
- Ok. 15 km/h, widoczny z daleka po światłach, słychać silnik. Zupełnie inny model jazdy (gąsienice).
- Frez z tyłu przywraca śnieg do stanu świeżego i zostawia charakterystyczny sztruks.
- Zderzenie z graczem: gracz ląduje w śniegu ragdollem, ratrak jedzie dalej.
- **Punkty za każdy metr kwadratowy odnowionego śniegu** — opłaca się jechać tam, gdzie najgorzej.

## 7. Sprzęt i ekonomia

### Wypożyczalnia (prawdziwy budynek, po którym się chodzi)
Narty w stojakach, deski na ścianie, kaski na półce. Podchodzisz, widzisz słupki parametrów
nad sprzętem, bierzesz. Widzisz też, co wybrali koledzy.

**Katalog: 6 par nart + 6 desek + 3 kaski.** Po dwa modele na krój (sportowy / uniwersalny /
manewrowy) razy trzy poziomy jakości odblokowywane za punkty.

Trzy parametry, które realnie czuć w fizyce i są widoczne na słupkach:
- **promień skrętu** — jak ciasny łuk potrafi zatoczyć,
- **prędkość maksymalna** — opór ślizgu,
- **przyczepność krawędzi** — jak trzyma na lodzie.

Sportowe: szybkie i stabilne, szerokie łuki, karzą błędy. Manewrowe: kręcą się jak zabawka,
ale na stromym uciekają.

### Budka z kolorami
Osobne kolory (paleta ~12 na część): **kurtka, spodnie, czapka/kask**, **kolor i wzór sprzętu**,
**gogle, rękawice, szalik**. Do tego **trzy osobne modele postaci** (własna sylwetka każdy).

### Kafejka
Trzy półki za punkty:
- **sprzęt** — odblokowanie lepszych nart/desek (potem bierzesz je w wypożyczalni bez opłaty),
- **wygląd** — czapki, gogle, wzory kurtek, naklejki na deskę,
- **drobiazgi** — herbata (natychmiast odnawia ciepło), mapa pokazująca stan śniegu, klucz do ratraka.

**Punkty liczą się tylko w ramach jednej sesji.** Nic się nie zapisuje między wejściami —
więc balans musi dawać pierwsze odblokowania po kilku zjazdach.

### Za co punkty
Skoki i triki • przeszkody (bramki, rury, slalom) • praca ratrakiem.
Nie za samą prędkość — to nie wyścig.

## 8. Zimno

Drugi pasek, łagodny, **nigdy nie kończy gry**:
- spada przez ~8 minut na mrozie,
- nisko: postać drży, obraz lekko blednie, krawędzie gorzej trzymają — jedziesz dalej, tylko słabiej,
- grzeje: kafejka (szybko), ognisko (wolniej), herbata (natychmiast); cieplejsza kurtka spowalnia utratę,
- wieczór i noc wychładzają szybciej niż południe.

## 9. Dolna stacja

Wypożyczalnia, budka z kolorami, kafejka — **wszystkie z wnętrzem, do którego się wchodzi**
(kafejka z krzesłami, przy których można usiąść z ekipą). Do tego **garaż ratraka z warsztatem**,
**parking, drogowskazy i tablica z mapą tras pokazująca stan śniegu na każdej**,
oraz **ognisko/grill** świecące wieczorem.

## 10. Świat i wygląd

- **Fotorealizm** z budżetem klatki. Docelowy sprzęt graczy: **klasa GTX 1650 Ti i wyżej**.
- Materiały PBR, niebo z HDRI, mgła powietrzna, śnieg z mapą normalną i widocznym sztruksem,
  miękkie niebieskie cienie, blask od słońca.
- **Płynny cykl dnia** — od poranka po noc pod reflektorami stoku.
- **Wszystkie modele 3D robione przez Blender MCP** (wzorzec [[gzowo-builders]]).
- Automatyczny suwak jakości: gra mierzy klatki i sama ustawia cienie, zasięg widzenia,
  gęstość lasu, jakość śniegu, odbicia. Plus ustawienia ręczne.

## 11. Multiplayer

- **2–5 graczy**, WebRTC P2P, Firebase RTDB **wyłącznie na sygnalizację i listę pokoi**.
- **Lista otwartych pokoi** w menu — widzisz kto gra i klikasz. Przy zakładaniu przełącznik
  „widoczny dla wszystkich" / „tylko z kodem". Host może wyrzucić gracza z pokoju.
- **Automatyczne przekazanie roli hosta** — każdy klient trzyma świeżą kopię stanu śniegu,
  więc odpadnięcie hosta to sekunda zacięcia, nie koniec zabawy.
- **Tryb gospodarza bez renderowania**: osobna zakładka, która NIE rysuje świata — trzyma tylko
  siatkę śniegu, liczy wspólną fizykę i rozsyła stan. MacBook Jurka (Radeon 5500M) stoi w tym trybie
  godzinami przy ułamku mocy, a fotorealizm obciąża wyłącznie maszyny grające.
- **Gra solo działa w pełni** — pokój z jednym graczem, który jest zarazem hostem.
- Komunikacja: **nick nad głową** (znika z odległością) + **emotki/gesty na klawiszach**
  (machanie, kciuk w górę, siad). Bez czatu tekstowego, bez czatu głosowego.

## 12. Cel sesji

Piaskownica + **tablica wyników na żywo** w rogu ekranu (kto ile punktów w tej sesji).
Do tego kilka **wyzwań dnia** losowanych przy zakładaniu pokoju
(„przejedź całą czarną bez wywrotki", „odnów śnieg na 500 m²").

## 13. Menu i ekran ładowania

Kamera krąży leniwie wokół dolnej stacji (sklep, kafejka, orczyk), po ~20 s płynnie przelatuje
wzdłuż liny na górną stację i orbituje tam, potem wraca. Ruch myszy delikatnie przechyla kamerę
i przesuwa plany — góry z tyłu prawie stoją, śnieżynki z przodu płyną szybko (parallax).

**Do tego drobne życie w scenie**: postacie-widma zjeżdżają po stoku, krzesełka się kręcą,
ratrak sunie w górę.

To ta sama, prawdziwa scena gry — więc ładowanie świata dzieje się w tle, a menu płynnie
„odjeżdża" w rozgrywkę.

## 14. Dźwięk

- **Własne pliki mają pierwszeństwo** — `assets/audio/` (już jest `chairlift.mp3`).
- Reszta **fetchowana z sieci** (CC0 z otwartym CORS, wzorzec [[mecca-chameleon]] / [[gzowo-meadow]]),
  synteza jako uczciwy fallback.
- **Muzyka tylko w menu i w kafejce** (przygaszone radio). Na stoku sam świat: szuranie krawędzi
  po śniegu, wiatr, silnik ratraka, skrzypienie krzesełka — to one niosą wrażenie prędkości.

## 15. Fizyka

**Własny model narciarza na polu wysokości** — sami liczymy składową grawitacji wzdłuż stoku,
tarcie zależne od stanu śniegu, przyczepność krawędzi, opór powietrza. Pełna kontrola nad tym,
jak sprzęt i śnieg zmieniają jazdę.

**Ragdoll**: osobny układ (kościec z kilkunastu punktów na więzach Verleta) + odpadający sprzęt
jako osobne obiekty fizyczne synchronizowane między graczami.

## 16. Jak budujemy

Fazami wewnętrznie (żeby fizyka śniegu dała się sprawdzić pomiarem), ale **w jednym przebiegu,
bez zatrzymywania się po każdej fazie na akceptację**. Jurek dostaje kompletną grę.

Kolejność: teren + śnieg + jazda → wyciągi → sklep i sprzęt → ragdoll → ratrak →
multiplayer → budynki → cykl dnia → menu.
