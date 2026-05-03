import { Directive, Input, EventEmitter, Output, ElementRef, HostListener } from '@angular/core';

@Directive({
    selector: '[appScrollSpy]',
    standalone: true
})
export class ScrollSpyCommonDirective {
    @Input() public spiedTags: any[] = [];
    @Output() public sectionChange = new EventEmitter<string>();
    private currentSection?: string;

    constructor(private _el: ElementRef) {}

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
                if ((element.offsetTop - parentOffset) <= scrollTop) {
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
