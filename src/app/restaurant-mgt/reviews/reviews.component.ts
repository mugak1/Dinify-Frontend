
import { AfterViewInit, Component, ElementRef, Inject, QueryList, ViewChildren, DOCUMENT } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { RatingSummary, ReviewListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';

@Component({
    selector: 'app-reviews',
    templateUrl: './reviews.component.html',
    styleUrl: './reviews.component.css',
    standalone: false
})
export class ReviewsComponent implements AfterViewInit {
  restaurant: string='';
  list: ReviewListItem[]=[];
  lp=[1,2,3,4,5]
  readmore_array:any[]=[];
  @ViewChildren('parareviewcontent') contentElements!: QueryList<ElementRef<HTMLParagraphElement>>;
  summary?: RatingSummary;
  showDateDropdown: boolean = false;
  selectedDateRange: string = 'Last 30 days';
  currentDateRangeDays: number = 30;
  constructor(private auth:AuthenticationService, private fb:FormBuilder,private api:ApiService,private route:ActivatedRoute,@Inject(DOCUMENT) private document: Document) {
    if(auth.currentRestaurantRole?.restaurant_id){
      this.restaurant=auth.currentRestaurantRole?.restaurant_id;
     // this.enc_restaurant=btoa(this.restaurant)
       this.loadReviews()
    }else 
    if(this.route.parent?.snapshot.params['id']){
      this.restaurant=this.route.parent?.snapshot.params['id'];
     // this.enc_restaurant=btoa(this.restaurant)
        this.loadReviews();
    }
//this.bsref=this.document.location.origin;
//this.CreateTable5();
  }

  toggleDateDropdown(): void {
    this.showDateDropdown = !this.showDateDropdown;
  }

  setDateRange(days: number): void {
    this.currentDateRangeDays = days;
    if (days === 7) {
      this.selectedDateRange = 'Last 7 days';
    } else if (days === 30) {
      this.selectedDateRange = 'Last 30 days';
    } else if (days === 90) {
      this.selectedDateRange = 'Last 90 days';
    }
    this.showDateDropdown = false;
    this.loadReviews();
  }

loadReviews(){
    
  this.api.get(null,'restaurant-setup/orderreviews/',{restaurant:this.restaurant}).subscribe((x)=>{

    this.list= x.data?.records as any[];
    this.summary =(<any>x?.data)?.summary as any;
    this.readmore_array=Array(this.list?.length).fill(false);
  
  },(_err)=>{
  },()=>{
    setTimeout(() => {
      this.checkOverflow();
    }, 100);
      
  })
}
/* show(v?:HTMLParagraphElement,id:any){
  return v.scrollHeight > v.offsetHeight;
} */
  // eslint-disable-next-line @angular-eslint/no-empty-lifecycle-method
  ngAfterViewInit(): void {
    // overflow check is deferred until after data loads in loadReviews()
  }

show(v:any){
 const btn:HTMLParagraphElement= this.document.getElementById('revTxt'+v) as any;
 return btn?.scrollHeight > btn?.offsetHeight;
}
private checkOverflow(): void {
  this.contentElements.forEach((elementRef, index) => {
    const element = elementRef.nativeElement;
    this.list[index].showReadMore = element.scrollHeight > element.offsetHeight;
  });

}
toggleReadMore(index: number): void {
  this.list[index].isExpanded = !this.list[index].isExpanded;
}
test=[
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin sit amet velit nunc. Praesent varius est a augue aliquam, quis volutpat lorem suscipit. Nulla facilisi. Morbi ac magna vitae justo pellentesque pharetra.",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin sit amet velit nunc. Praesent varius est a augue aliquam, quis volutpat lorem suscipit. Nulla facilisi. Morbi ac magna vitae justo pellentesque pharetra.Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin sit amet velit nunc. Praesent varius est a augue aliquam, quis volutpat lorem suscipit. Nulla facilisi. Morbi ac magna vitae justo pellentesque pharetra.",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin sit amet velit nunc. Praesent varius est a augue aliquam, quis volutpat lorem suscipit. Nulla facilisi. Morbi ac magna vitae justo. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin sit amet velit nunc. Praesent varius est a augue aliquam, quis volutpat lorem suscipit. Nulla facilisi. Morbi ac magna vitae justo.. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin sit amet velit nunc. Praesent varius est a augue aliquam, quis volutpat lorem suscipit. Nulla facilisi. Morbi ac magna vitae justo."
]
}
