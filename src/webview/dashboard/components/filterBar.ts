/**
 * Filter Bar - Search input with debounced filtering and clickable filter chips
 */

import { DashboardState } from '../state';
import { debounce } from '../utils/debounce';

// Track if filter bar has been initialized
let initialized = false;

/**
 * Render filter bar with search and chips
 */
export function renderFilterBar(
  container: HTMLElement,
  state: DashboardState,
  onFilterChange: () => void
): void {
  // Only create elements on first render
  if (!initialized) {
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'search-input';
    searchInput.placeholder = 'Search processes and ports...';
    searchInput.id = 'search-input';

    // Debounced search handler (300ms)
    searchInput.addEventListener(
      'input',
      debounce((e: Event) => {
        const target = e.target as HTMLInputElement;
        state.filter.text = target.value;
        onFilterChange();
      }, 300)
    );

    container.appendChild(searchInput);

    // Create filter chips
    const chips = [
      { id: 'running', label: 'Running' },
      { id: 'orphans', label: 'Orphans' },
      { id: 'with-ports', label: 'With Ports' }
    ];

    for (const { id, label } of chips) {
      const chip = document.createElement('div');
      chip.className = 'filter-chip';
      chip.dataset.chip = id;
      chip.textContent = label;

      chip.addEventListener('click', () => {
        const chipId = chip.dataset.chip;
        if (!chipId) return;

        if (state.filter.chips.has(chipId)) {
          state.filter.chips.delete(chipId);
          chip.classList.remove('active');
        } else {
          state.filter.chips.add(chipId);
          chip.classList.add('active');
        }

        onFilterChange();
      });

      container.appendChild(chip);
    }

    initialized = true;
  } else {
    // Update active states based on current filter
    const chips = container.querySelectorAll('.filter-chip');
    chips.forEach(chip => {
      const chipId = (chip as HTMLElement).dataset.chip;
      if (chipId) {
        if (state.filter.chips.has(chipId)) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      }
    });

    // Update search input value
    const searchInput = container.querySelector('.search-input') as HTMLInputElement;
    if (searchInput && searchInput.value !== state.filter.text) {
      searchInput.value = state.filter.text;
    }
  }
}
