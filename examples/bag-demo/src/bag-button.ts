import { openBagPanel } from './bag-panel';

export function bindBagButton(button: HTMLButtonElement): void {
  button.addEventListener('click', () => {
    void openBagPanel();
  });
}

export const bagButtonId = 'bag-button';
