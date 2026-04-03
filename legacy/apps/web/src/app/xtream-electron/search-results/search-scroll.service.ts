import { Injectable } from '@angular/core';

/**
 * Holds scroll position for the search results view so it can be restored
 * when navigating back from a program detail page.
 */
@Injectable({ providedIn: 'root' })
export class SearchScrollService {
    private savedScrollTop = 0;

    saveScrollTop(value: number): void {
        this.savedScrollTop = value;
    }

    getAndClearScrollTop(): number {
        const value = this.savedScrollTop;
        this.savedScrollTop = 0;
        return value;
    }
}
