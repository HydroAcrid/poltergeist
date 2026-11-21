const film = document.getElementById('film');
const round = document.getElementById('round');
const angles = document.getElementById('angles');
const watch = document.getElementById('watch');
const inspect = document.getElementById('inspect');
const chapters = [...document.querySelectorAll('[data-start]')];

function showAngles(compare) {
  if (compare) film.pause();
  angles.hidden = !compare;
  round.hidden = compare;
  watch.setAttribute('aria-pressed', String(!compare));
  inspect.setAttribute('aria-pressed', String(compare));
}

watch.addEventListener('click', () => showAngles(false));
inspect.addEventListener('click', () => showAngles(true));

for (const chapter of chapters) {
  chapter.addEventListener('click', () => {
    film.currentTime = Number(chapter.dataset.start);
    film.play().catch(() => film.focus());
  });
}

function highlightChapter() {
  const active = chapters.findLast(button => film.currentTime >= Number(button.dataset.start));
  for (const chapter of chapters) chapter.setAttribute('aria-current', String(chapter === active));
}
film.addEventListener('timeupdate', highlightChapter);
highlightChapter();
