import { AfterViewInit, Directive, Input, EventEmitter, Output, ElementRef, HostListener } from '@angular/core';

@Directive({
    selector: '[appScrollSpy]',
    standalone: true
})
export class ScrollSpyCommonDirective implements AfterViewInit {
    @Input() public spiedTags: any[] = [];
    /**
     * Pixels of sticky chrome covering the top of the scroll viewport (e.g. the
     * diner menu's ~150px sticky banner). A section becomes "active" once its top
     * reaches the BOTTOM of that chrome — i.e. once it's actually visible — rather
     * than when it reaches viewport y=0 behind the banner. Default 0 = legacy
     * behaviour for consumers with no sticky overlay.
     */
    @Input() public stickyOffset = 0;
    @Output() public sectionChange = new EventEmitter<string>();
    private currentSection?: string;

    constructor(private _el: ElementRef) {}

    ngAfterViewInit(): void {
        // Seed initial section detection without waiting for a scroll event.
        // Catches browser scroll restoration (page mounted with scrollY > 0)
        // and the scrollY=0 case where no scroll event ever fires. Deferred
        // a tick so the spied children are in the DOM by the time we measure.
        setTimeout(() => {
            const el = this._el.nativeElement as HTMLElement;
            const computed = window.getComputedStyle(el);
            const overflowY = computed.overflowY;
            if (overflowY === 'scroll' || overflowY === 'auto') {
                const scrollTop = el.scrollTop;
                const parentOffset = el.offsetTop;
                this.findCurrentSection(scrollTop, parentOffset);
            } else {
                const rect = el.getBoundingClientRect();
                const scrollTop = window.scrollY;
                const parentOffset = rect.top + scrollTop;
                this.findCurrentSection(scrollTop, parentOffset);
            }
        }, 0);
    }

    @HostListener('scroll', ['$event'])
    onHostScroll(event: any) {
        // Host-scroll mode — the host element has its own overflow and scrolls internally.
        const scrollTop = event.target.scrollTop;
        const parentOffset = event.target.offsetTop;
        this.findCurrentSection(scrollTop, parentOffset);
    }

    @HostListener('window:scroll')
    onWindowScroll() {
        // Window-scroll mode — the host element does not scroll itself; the page does.
        // Only react to window scroll when the host is not a scroll container, so that
        // existing consumers with overflow-y: auto/scroll continue to use host scroll
        // exclusively and don't get double-fired.
        const el = this._el.nativeElement as HTMLElement;
        const computed = window.getComputedStyle(el);
        const overflowY = computed.overflowY;
        if (overflowY === 'scroll' || overflowY === 'auto') {
            return;
        }
        const rect = el.getBoundingClientRect();
        const scrollTop = window.scrollY;
        const parentOffset = rect.top + scrollTop; // host's absolute position in the document
        this.findCurrentSection(scrollTop, parentOffset);
    }

    private findCurrentSection(scrollTop: number, parentOffset: number) {
        const children = this._el.nativeElement.children;
        const spiedSections: HTMLElement[] = [];
        for (let i = 0; i < children.length; i++) {
            const element = children[i];
            if (this.spiedTags.some(spiedTag => spiedTag === element.tagName)) {
                spiedSections.push(element);
            }
        }
        if (spiedSections.length === 0) return;

        // At the very top, always emit the first section. Guards against any
        // sub-pixel offset math leaving the first (often short) section
        // un-matched at scrollY 0.
        let currentSection: string;
        if (scrollTop < 4) {
            currentSection = spiedSections[0].id;
        } else {
            // Last section whose top is <= threshold; fallback to first when
            // none satisfy (e.g. sticky-header offsets place all sections
            // below the threshold at the top of the page).
            currentSection = spiedSections[0].id;
            for (const element of spiedSections) {
                if ((element.offsetTop - parentOffset) <= (scrollTop + this.stickyOffset)) {
                    currentSection = element.id;
                }
            }
        }

        if (currentSection !== this.currentSection) {
            this.currentSection = currentSection;
            this.sectionChange.emit(this.currentSection);
        }
    }
}
