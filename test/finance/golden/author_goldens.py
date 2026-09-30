# Authoring source of test/finance/golden/financial-core-goldens.json.
# Every expected value below is written literally by hand (R1.2/R1.3 golden contract,
# revised by the R1.4 owner decisions and the FINAL owner contract of 2026-09-29:
# MARJIN_FIN/2 + MARJIN_LABOR/2 + MARJIN_NORM/3; amended by the owner-approved closed-days
# decision of 2026-09-30 => MARJIN_FIN/3 + MARJIN_LABOR/3); nothing here calls the Financial Core.
# Closed-days amendment (CD-M1): monthly global/fixed entitlement is placed on eligible dates —
# every date except a declared closure already COMPLETED (< asOf). Without closures this equals
# the previous calendar-day placement, so only the closed-day cases O-02/O-15/O-20 and the two
# identifier cases G-10/R1-G change (listed as owner-authorized supersessions in the CD-M1 handoff).
# Regenerate the JSON with:  python3 test/finance/golden/author_goldens.py
#
# FINAL owner contract reminders used by the hand computations below:
#  - Actual MTD (open_month) = month start .. asOf-1 (last completed day); asOf itself is outside Actual.
#  - labor = hourly employer cost (`payroll`) + global monthly employer cost / calendar days, every calendar day.
#  - fixed = monthly / calendar days, every calendar day (closed days included).
#  - `hourly_payroll` is never counted.
import json, os
C=[]
def case(**k): C.append(k)
SAL30={"employees":[{"id":"e1","type":"global","monthlySalary":"30000"}]}  # global monthly FULL EMPLOYER COST (owner contract)
def V(vid,frm,rec,glob=None,fixed=None,rent=None,roy=None,basis="recorded"):
    return {"versionId":vid,"effectiveFrom":frm,"recordedAt":rec,"basis":basis,
     "globalEmployees":[{"employeeKey":k,"kind":"authoritative_employer_cost","monthlyAmount":v,"sourceSystem":"marjin_employee_config","ingestionMethod":"manual"} for k,v in (glob or {}).items()],
     "fixedItems":[{"itemKey":k,"monthlyAmount":v} for k,v in (fixed or {}).items()],
     "rent":rent or {"mode":"none"},"royalty":roy or {"mode":"none"}}
AUTH30=[V("auth","0000-01-01",1,{"e1":"30000"},{"f1":"3000"})]
def rep(frm,to,row,prefix="g"): return {"from":frm,"to":to,"row":row,"prefix":prefix}
SEPT={"kind":"open_month","month":"2026-09"}
CLOSED_SEPT={"kind":"closed_month","month":"2026-09"}
FULL={"sales":"1000","supplier_payments":{"s1":"300"},"payroll":"200"}

# ---------- R1.2 goldens (BD-3 / final contract revised where noted) ----------
case(id="G-01",desc="closed month Aug 2026: global monthly employer cost 31000 over 31 calendar days",asOf="2026-09-05",window={"kind":"closed_month","month":"2026-08"},
 expand=[rep("2026-08-01","2026-08-31",FULL)],
 config={"employees":[{"id":"e1","type":"global","monthlySalary":"31000"}]},fixed=[{"id":"f1","amount":"6200"}],
 expect={"report.actual.revenue.value":"31000","report.actual.purchases.value":"9300","report.actual.hourlyLabor.value":"6200",
 "report.actual.labor.globalEmployerCost":{"state":"complete","value":"31000","issues":[]},"report.actual.fixedAccrual.total":"6200",
 "report.actual.labor.employerCost.value":"37200","report.actual.labor.employerCostPct.value":"120",
 "report.actual.operatingProfit":{"state":"complete","value":"-21700","issues":[]},
 "report.actual.purchasesPct.value":"30","report.coverage.revenue.presentDays":31,
 "report.window.currentDay":None,"report.window.completedThrough":"2026-08-31","report.window.recognizedDays":31,"report.actual.revenue.complete":True})
case(id="G-02",desc="open MTD asOf 09-17: Actual is 09-01..09-16 (D-1); the current-day row stays outside Actual",asOf="2026-09-17",window=SEPT,
 expand=[rep("2026-09-01","2026-09-16",{"sales":"1000"})],rows=[{"id":"today","date":"2026-09-17","sales":"500"}],timeline=AUTH30,
 expect={"report.actual.revenue.value":"16000","report.actual.labor.globalEmployerCost.value":"16000","report.actual.fixedAccrual.regular":"1600",
 "report.actual.operatingProfit.state":"incomplete_components","report.actual.operatingProfit.value":None,
 "report.window.currentDay":{"date":"2026-09-17","inActual":False},"report.window.to":"2026-09-16","report.window.completedThrough":"2026-09-16",
 "report.window.recognizedDays":16,"report.window.rule":"completed_days_through_d_minus_1","day.2026-09-17.revenue.value":"500"})
case(id="G-03",desc="first day of month: no completed day yet (empty Actual window), nothing accrued",asOf="2026-09-01",window=SEPT,rows=[],timeline=AUTH30,
 expect={"report.window.state":"no_completed_days","report.window.recognizedDays":0,"report.window.completedThrough":None,
 "report.window.currentDay":{"date":"2026-09-01","inActual":False},"report.actual.revenue.value":None,"report.actual.revenue.presentDays":0,
 "report.actual.labor.globalEmployerCost":{"state":"empty_window","value":None,"issues":[]},"report.actual.fixedAccrual.total":None,"report.actual.fixedAccrual.state":"empty_window",
 "report.actual.operatingProfit":{"state":"empty_window","value":None,"issues":[]},"report.actual.contributionBeforeFixed.state":"empty_window",
 "report.actual.labor.employerCostPct":{"state":"empty_window"},"report.actual.purchasesPct":{"state":"empty_window"}})
case(id="G-04",desc="partial current-day row (revenue and purchases) stays outside Actual (supersedes BD-3 'today live')",asOf="2026-09-10",window=SEPT,
 expand=[rep("2026-09-01","2026-09-09",{"sales":"1000"})],rows=[{"id":"t","date":"2026-09-10","sales":"300","supplier_payments":{"s1":"100"}}],timeline=AUTH30,
 expect={"report.actual.revenue.value":"9000","report.actual.purchases.value":None,"report.actual.labor.globalEmployerCost.value":"9000",
 "report.window.currentDay":{"date":"2026-09-10","inActual":False},"day.2026-09-10.purchases.value":"100"})
case(id="G-05",desc="three rows on one date: additive fields, per-key maps, notes collected; legacy hourly_payroll kept but not labor",asOf="2026-09-05",window=SEPT,
 rows=[{"id":"A","date":"2026-09-05","sales":"100.10","supplier_payments":{"s1":"50"},"hourly_payroll":{"e1":"10"},"notes":"a"},
       {"id":"B","date":"2026-09-05","sales":200.2,"supplier_payments":{"s1":"25","s2":"5"},"hourly_payroll":{"e1":"5"},"notes":"b"},
       {"id":"C","date":"2026-09-05","deliveries":"50","payroll":"0"}],
 expect={"day.2026-09-05.revenue.value":"350.3","day.2026-09-05.purchases.value":"80","day.2026-09-05.purchases.bySource.supplier:s1":"75",
 "day.2026-09-05.purchases.bySource.supplier:s2":"5","day.2026-09-05.hourlyLabor.value":"0","day.2026-09-05.legacyHourlyPayroll.byEmployee.e1":"15",
 "day.2026-09-05.legacyHourlyPayroll.counted":False,"day.2026-09-05.legacyHourlyPayroll.rows":["A","B"],
 "day.2026-09-05.contributions":["A","B","C"],"day.2026-09-05.rowCount":3,"day.2026-09-05.annotations.notes":[{"rowId":"A","value":"a"},{"rowId":"B","value":"b"}]})
case(id="G-06",type="error",desc="duplicate row id rejects the dataset",asOf="2026-09-05",window=SEPT,
 rows=[{"id":"X","date":"2026-09-01","sales":"1"},{"id":"X","date":"2026-09-02","sales":"2"}],expectError="duplicate_row_id")

# ---------- R1.3 explicit-zero goldens (asOf moved one day later so the tested day is completed) ----------
BASEZ=[rep("2026-09-01","2026-09-09",{"sales":"1000"})]
case(id="G-07a-A",desc="missing day 10",asOf="2026-09-11",window=SEPT,expand=BASEZ,rows=[],
 expect={"report.actual.revenue.value":"9000","report.coverage.revenue.presentDays":9,"report.coverage.revenue.missingDays":["2026-09-10"],
 "report.actual.averages.revenuePerPresentDay.value":"1000","day.2026-09-10.presence.day":"missing","day.2026-09-10.revenue.value":None})
case(id="G-07a-B",desc="explicit zero day 10 (same totals, different coverage/average)",asOf="2026-09-11",window=SEPT,expand=BASEZ,
 rows=[{"id":"z","date":"2026-09-10","sales":"0","payroll":"0","supplier_payments":{"s1":"0"}}],
 expect={"report.actual.revenue.value":"9000","report.coverage.revenue.presentDays":10,"report.coverage.revenue.missingDays":[],
 "report.actual.averages.revenuePerPresentDay.value":"900","day.2026-09-10.presence.day":"present",
 "day.2026-09-10.revenue.value":"0","day.2026-09-10.purchases.value":"0","day.2026-09-10.hourlyLabor.value":"0",
 "day.2026-09-10.purchases.bySource.supplier:s1":"0","dm.2026-09-10.foodCostPct":None,"dm.2026-09-10.presence.revenue":"present"})
case(id="G-07d",desc="explicit zero purchases vs absent purchases",asOf="2026-09-07",window=SEPT,
 rows=[{"id":"p0","date":"2026-09-05","sales":"1000","supplier_payments":{"s1":"0"}},{"id":"pa","date":"2026-09-06","sales":"1000"}],
 expect={"dm.2026-09-05.foodCostPct":0,"dm.2026-09-06.foodCostPct":None,"report.coverage.purchases.missingDays":["2026-09-01","2026-09-02","2026-09-03","2026-09-04","2026-09-06"],
 "report.actual.purchasesPct":{"state":"incomplete_components"},"report.actual.operatingProfit.state":"incomplete_components","report.actual.operatingProfit.value":None},
 expectFlags=[{"code":"ratio_numerator_incomplete","date":"2026-09-06","field":"purchases"}])
case(id="G-07e",desc="zero-labor day included in hourly totals; absent excluded; labor % not a value while a day is missing",asOf="2026-09-05",window=SEPT,
 rows=[{"id":"l1","date":"2026-09-01","sales":"1000","payroll":"300"},{"id":"l2","date":"2026-09-02","sales":"1000","payroll":"0"},
       {"id":"l3","date":"2026-09-03","sales":"1000","payroll":"300"},{"id":"l4","date":"2026-09-04","sales":"1000"}],
 expect={"report.actual.hourlyLabor.value":"600","report.actual.hourlyLabor.presentDays":3,
 "report.actual.averages.hourlyLaborPerPresentDay.value":"200","report.actual.labor.employerCostPct":{"state":"incomplete_components"}},
 expectFlags=[{"code":"ratio_numerator_incomplete","date":"2026-09-04","field":"hourlyLabor"}])
case(id="G-07g",desc="skip-only supplier map is a recorded no-purchase",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"s","date":"2026-09-01","sales":"500","supplier_payments":{"s1":"skip"}}],
 expect={"day.2026-09-01.purchases.presence":"present","day.2026-09-01.purchases.value":"0","day.2026-09-01.purchases.bySource.supplier:s1":"0","report.coverage.purchases.presentDays":1})
case(id="G-07h",desc="notes-only row: day missing, annotation kept",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"n","date":"2026-09-01","sales":"","notes":"closed for inspection"}],
 expect={"day.2026-09-01.presence.day":"missing","day.2026-09-01.rowCount":1,"day.2026-09-01.annotations.notes":[{"rowId":"n","value":"closed for inspection"}],
 "report.coverage.revenue.missingDays":["2026-09-01"],"report.operatingCalendar.closedDates":[]},
 expectFlags=[{"code":"rows_without_financial_values","date":"2026-09-01"}])
case(id="G-07i",desc="invalid-only revenue: invalid, never zero",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"i","date":"2026-09-01","sales":"12,5"}],
 expect={"day.2026-09-01.presence.revenue":"invalid","day.2026-09-01.revenue.value":None,"day.2026-09-01.presence.day":"missing",
 "report.coverage.revenue.invalidDays":["2026-09-01"],"report.actual.revenue.value":None},
 expectFlags=[{"code":"invalid_cell","rowId":"i","field":"sales","reason":"ambiguous_comma"}])
case(id="G-07j",desc="partial row",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"pr","date":"2026-09-01","sales":"1000","deliveries":"abc"}],
 expect={"day.2026-09-01.revenue.presence":"present","day.2026-09-01.revenue.value":"1000","day.2026-09-01.revenue.partial":True},
 expectFlags=[{"code":"metric_partial_invalid","rowId":"pr","field":"revenue"}])
case(id="G-07k",desc="same-date presence folds",asOf="2026-09-03",window=SEPT,
 rows=[{"id":"a1","date":"2026-09-01","sales":""},{"id":"b1","date":"2026-09-01","sales":"0"},
       {"id":"a2","date":"2026-09-02","sales":"x"},{"id":"b2","date":"2026-09-02","sales":"500"}],
 expect={"day.2026-09-01.revenue.presence":"present","day.2026-09-01.revenue.value":"0","day.2026-09-02.revenue.value":"500","day.2026-09-02.revenue.partial":True},
 expectFlags=[{"code":"invalid_cell","rowId":"a2","field":"sales","reason":"bad_grammar"}])
case(id="G-07l",desc="forecast input: zero day entered, missing day omitted",asOf="2026-09-10",window=SEPT,expand=BASEZ,
 rows=[{"id":"z","date":"2026-09-10","sales":"0"}],
 expect={"fd.2026-09-10":{"date":"2026-09-10","total":0,"had_entry":True,"has_sales":False,"is_exception":False},"fd.2026-09-08":{"date":"2026-09-08","total":1000,"had_entry":True,"has_sales":True,"is_exception":False}})
case(id="G-07l-missing",desc="forecast input: missing day",asOf="2026-09-10",window=SEPT,expand=BASEZ,rows=[],expect={"fd.2026-09-10":None})
case(id="G-07m",desc="input freshness: latest present day <= asOf (entry freshness, not Actual), zero counts, future ignored",asOf="2026-09-10",window=SEPT,expand=BASEZ,
 rows=[{"id":"z","date":"2026-09-10","sales":"0"},{"id":"fut","date":"2026-09-20","sales":"5"}],
 expect={"latest":"2026-09-10","q.futureRows":[{"rowId":"fut","date":"2026-09-20"}],"report.window.to":"2026-09-09"})
case(id="G-07n",desc="no revenue recorded but costs: profit unavailable",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"c","date":"2026-09-01","supplier_payments":{"s1":"100"},"payroll":"50"}],config=SAL30,
 expect={"report.actual.operatingProfit.state":"revenue_missing","report.actual.operatingProfit.value":None,"report.actual.contributionBeforeFixed.value":None,"report.actual.purchases.value":"100","report.actual.purchasesPct":{"state":"incomplete_components"}})

case(id="G-08",desc="future rows quarantined",asOf="2026-09-10",window=SEPT,
 rows=[{"id":"a","date":"2026-09-09","sales":"100"},{"id":"f1","date":"2026-09-11","sales":"999"},{"id":"f2","date":"2026-10-01","sales":"999"}],
 expect={"report.actual.revenue.value":"100","report.quarantine.futureRows":[{"rowId":"f1","date":"2026-09-11"},{"rowId":"f2","date":"2026-10-01"}]},
 expectFlags=[{"code":"future_row_quarantined","rowId":"f1","date":"2026-09-11"}])
case(id="G-09",desc="future month has no actual window",asOf="2026-09-10",window={"kind":"open_month","month":"2026-10"},rows=[{"id":"a","date":"2026-09-10","sales":"100"}],
 expect={"report.window.state":"future_period","report.window.recognizedDays":0,"report.actual.revenue.value":None,"report.window.currentDay":None})
case(id="G-10",desc="historical month on compatibility basis is labelled; global amount is employer cost",asOf="2026-09-10",window={"kind":"closed_month","month":"2026-08"},
 expand=[rep("2026-08-01","2026-08-31",{"sales":"100"})],config=SAL30,
 expect={"report.configurationBasis":["current_applied_retrospectively"],"report.timelineSource":"compat_current_config",
 "report.actual.labor.globalEmployerCost":{"state":"complete","value":"30000","issues":[]},"report.actual.labor.globalAllocation":"eligible_days_excluding_completed_closures"})
case(id="G-11-mid",desc="global amount change on day 15: 30000*14/30 + 45000*16/30",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],
 timeline=[V("v1","2026-09-01",1,{"e1":"30000"}),V("v2","2026-09-15",2,{"e1":"45000"})],expect={"report.actual.labor.globalEmployerCost.value":"38000","report.costVersionsApplied":["v1","v2"]})
case(id="G-11-first",desc="global amount change on day 1",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],
 timeline=[V("v1","2026-08-01",1,{"e1":"30000"}),V("v2","2026-09-01",2,{"e1":"45000"})],expect={"report.actual.labor.globalEmployerCost.value":"45000","report.costVersionsApplied":["v2"]})
case(id="G-11-last",desc="global amount change on last day: 30000*29/30 + 45000/30",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],
 timeline=[V("v1","2026-08-01",1,{"e1":"30000"}),V("v2","2026-09-30",2,{"e1":"45000"})],expect={"report.actual.labor.globalEmployerCost.value":"30500"})
case(id="G-12",desc="employee added then removed mid-month",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],
 timeline=[V("v1","2026-08-01",1,{"e1":"30000"}),V("v2","2026-09-11",2,{"e1":"30000","e2":"15000"}),V("v3","2026-09-21",3,{"e2":"15000"})],
 expect={"report.actual.labor.globalEmployerCost.value":"30000","report.configurationBasis":["recorded"],"report.actual.labor.globalEmployeesApplied":2})
case(id="G-13",desc="two versions with the same effectiveFrom: later recordedAt wins",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],
 timeline=[V("vA","2026-09-01",1,{"e1":"30000"}),V("vB","2026-09-01",2,{"e1":"60000"})],
 expect={"report.actual.labor.globalEmployerCost.value":"60000","report.costVersionsApplied":["vB"]},expectFlags=[{"code":"superseded_versions","key":"vA"}])
case(id="G-14",desc="future-dated cost version does not affect the actual window (09-01..09-09)",asOf="2026-09-10",window=SEPT,rows=[],
 timeline=[V("v1","2026-09-01",1,{"e1":"30000"}),V("v2","2026-09-20",2,{"e1":"90000"})],expect={"report.actual.labor.globalEmployerCost.value":"9000","report.costVersionsApplied":["v1"]})
case(id="G-15",desc="recorded zero revenue with costs: real loss (VD-27)",asOf="2026-09-03",window=SEPT,
 rows=[{"id":"a","date":"2026-09-01","sales":"0","supplier_payments":{"s1":"100"},"payroll":"0"},{"id":"b","date":"2026-09-02","sales":"0","supplier_payments":{"s1":"skip"},"payroll":"0"}],config={},
 expect={"report.actual.revenue.value":"0","report.actual.purchasesPct.state":"zero_denominator","report.actual.operatingProfit":{"state":"complete","value":"-100","issues":[]},"dm.2026-09-01.foodCostPct":None})
case(id="G-16",desc="negative net revenue",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"a","date":"2026-09-01","sales":"-50","supplier_payments":{"s1":"10"}}],
 expect={"report.actual.revenue.value":"-50","report.actual.purchasesPct.state":"negative_denominator"},expectFlags=[{"code":"negative_amount","rowId":"a","field":"sales"}])
case(id="G-17",desc="refunds and offsetting supplier cells",asOf="2026-09-03",window=SEPT,
 rows=[{"id":"r1","date":"2026-09-01","supplier_payments":{"s1":"-40"}},{"id":"r2","date":"2026-09-02","supplier_payments":{"s1":"100","s2":"-100"},"food_cost":"70"}],
 expect={"day.2026-09-01.purchases.value":"-40","day.2026-09-02.purchases.value":"0","day.2026-09-02.purchases.bySource":{"supplier:s1":"100","supplier:s2":"-100"}},
 expectFlags=[{"code":"supplier_and_legacy_food_both","rowId":"r2","field":"food_cost"}])
# G-18 revised purchase cases P1-P10 (one date per case)
P=[("P1",[{"supplier_payments":{"s1":"100"}},{"supplier_payments":{"s1":"50","s2":"30"}}],"180",{"supplier:s1":"150","supplier:s2":"30"}),
   ("P2",[{"supplier_payments":{"s1":"100"}},{"sales":"500"}],"100",{"supplier:s1":"100"}),
   ("P3",[{"supplier_payments":{"s1":"100"}},{"food_cost":"70"}],"170",{"legacy_food_cost":"70","supplier:s1":"100"}),
   ("P4",[{"supplier_payments":{"s1":"100"},"food_cost":70}],"100",{"supplier:s1":"100"}),
   ("P5",[{"supplier_payments":{"s1":"100","s2":"-100"},"food_cost":"70"}],"0",{"supplier:s1":"100","supplier:s2":"-100"}),
   ("P6",[{"supplier_payments":{"s1":"0"},"food_cost":"70"}],"0",{"supplier:s1":"0"}),
   ("P7",[{"supplier_payments":{"s1":"skip"},"food_cost":"70"}],"0",{"supplier:s1":"0"}),
   ("P8",[{"supplier_payments":{"s1":"12,5"},"food_cost":"70"}],"70",{"legacy_food_cost":"70"}),
   ("P9",[{"supplier_payments":{"s1":"-40"}}],"-40",{"supplier:s1":"-40"}),
   ("P10",[{"supplier_payments":{"s1":"100"}},{"supplier_payments":{"s1":"100"}}],"200",{"supplier:s1":"200"})]
rows=[];exp={};flags=[]
for i,(name,rs,total,bys) in enumerate(P):
    d="2026-09-%02d"%(i+1)
    for j,r in enumerate(rs): rows.append(dict(r,id=f"{name}-{j}",date=d))
    exp[f"day.{d}.purchases.value"]=total; exp[f"day.{d}.purchases.bySource"]=bys
exp["day.2026-09-08.purchases.partial"]=True
case(id="G-18",desc="purchase cases P1-P10 (R1.3 revised: presence-based selection)",asOf="2026-09-10",window={"kind":"open_month","month":"2026-09"},rows=rows,expect=exp,
 expectFlags=[{"code":"supplier_and_legacy_food_both","rowId":"P4-0","field":"food_cost"},{"code":"supplier_and_legacy_food_both","rowId":"P5-0","field":"food_cost"},
 {"code":"supplier_and_legacy_food_both","rowId":"P6-0","field":"food_cost"},{"code":"supplier_and_legacy_food_both","rowId":"P7-0","field":"food_cost"},
 {"code":"invalid_cell","rowId":"P8-0","field":"supplier_payments","key":"s1","reason":"ambiguous_comma"},{"code":"negative_amount","rowId":"P9-0","field":"supplier_payments","key":"s1"}],
 expectNoFlags=[{"code":"supplier_and_legacy_food_both","rowId":"P8-0"}])
case(id="G-19",desc="map shapes: empty string, array, empty object, null, __proto__ key",asOf="2026-09-05",window={"kind":"open_month","month":"2026-09"},
 rows=[{"id":"m1","date":"2026-09-01","supplier_payments":"","hourly_payroll":""},{"id":"m2","date":"2026-09-02","supplier_payments":[5]},
       {"id":"m3","date":"2026-09-03","supplier_payments":{}},{"id":"m4","date":"2026-09-04","supplier_payments":None},
       {"id":"m5","date":"2026-09-05","supplier_payments":json.loads('{"__proto__":"10"}')}],
 expect={"day.2026-09-01.purchases.presence":"absent","day.2026-09-02.purchases.presence":"invalid","day.2026-09-03.purchases.presence":"absent",
 "day.2026-09-04.purchases.presence":"absent","day.2026-09-05.purchases.value":"10","day.2026-09-05.purchases.bySource.supplier:__proto__":"10"},
 expectFlags=[{"code":"invalid_map_shape","rowId":"m2","field":"supplier_payments"}])
case(id="G-20",desc="decimal edges E1-E3",asOf="2026-09-04",window=SEPT,
 rows=[{"id":"e1a","date":"2026-09-01","sales":"0.1"},{"id":"e1b","date":"2026-09-01","sales":"0.2"},
       {"id":"e2a","date":"2026-09-02","sales":"100.10"},{"id":"e2b","date":"2026-09-02","sales":200.2},
       {"id":"e3a","date":"2026-09-03","sales":"999999999999999"},{"id":"e3b","date":"2026-09-03","sales":"999999999999999"},
       {"id":"e3c","date":"2026-09-03","sales":"999999999999999"},{"id":"e3d","date":"2026-09-03","sales":"0.01"}],
 expect={"day.2026-09-01.revenue.value":"0.3","day.2026-09-02.revenue.value":"300.3","day.2026-09-03.revenue.value":"2999999999999997.01",
 "report.actual.revenue.value":"3000000000000297.61"})
case(id="G-20-pres",type="presenters",desc="E10 half-away-from-zero display",items=[
 ["money","2.5","₪3"],["money","-2.5","₪-3"],["money","-0.4","₪0"],["money","1234567.5","₪1,234,568"],["money",None,"—"],
 ["money","316539/62","₪5,105"],["percent","0.05","0.1%"],["percent","-0.05","-0.1%"],["percent","33.25","33.3%"],["percent","100/3","33.3%"],
 ["percent","316539/12400","25.5%"],["percent",None,"—"],["percent","0","0.0%"]])
case(id="G-21",type="cells",desc="commas",items=[
 ["1,234",False,"present","1234",True],["1,234.5",False,"present","1234.5",True],["12,5",False,"invalid","ambiguous_comma"],
 ["1,23",False,"invalid","ambiguous_comma"],["1,2345",False,"invalid","ambiguous_comma"]])
case(id="G-22",type="cells",desc="wrong types and grammar",items=[
 [True,False,"invalid","wrong_type"],[[5],False,"invalid","wrong_type"],[{},False,"invalid","wrong_type"],["1e3",False,"invalid","bad_grammar"],
 ["0x10",False,"invalid","bad_grammar"],[" 12 ",False,"present","12"],["007",False,"invalid","bad_grammar"],[".5",False,"invalid","bad_grammar"],
 ["1.",False,"invalid","bad_grammar"],["₪100",False,"invalid","bad_grammar"],["skip",False,"invalid","bad_grammar"],["skip",True,"present","0"],
 ["",False,"absent"],["   ",False,"absent"],[None,False,"absent"],["0",False,"present","0"],["-0",False,"present","0"],["0.00",False,"present","0"],[0,False,"present","0"],
 ["+5",False,"present","5"],["-12.50",False,"present","-12.5"]])
case(id="G-23",type="cells",desc="input limits",items=[
 ["999999999999999",False,"present","999999999999999"],["1000000000000000",False,"invalid","out_of_range"],["1.123456",False,"present","1.123456"],
 ["1.1234567",False,"invalid","out_of_range"],[1e21,False,"invalid","out_of_range"],[1.5e-7,False,"invalid","out_of_range"],[12.25,False,"present","12.25"]])
case(id="G-24",desc="stored includeVat:true row: flagged, used as stored, never divided",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"v","date":"2026-09-01","sales":"118","includeVat":True}],expect={"report.actual.revenue.value":"118"},expectFlags=[{"code":"vat_flag_unnormalized","rowId":"v","field":"includeVat"}])
case(id="G-25a",desc="E5 food % 1000/3000",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"a","date":"2026-09-01","sales":"3000","supplier_payments":{"s1":"1000"}}],expect={"report.actual.purchasesPct.value":"100/3","report.actual.purchasesPct.basisKind":"net_of_vat"})
case(id="G-25b",desc="E6 food % 3300/10000",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"a","date":"2026-09-01","sales":"10000","supplier_payments":{"s1":"3300"}}],expect={"report.actual.purchasesPct.value":"33"})
# 10 completed days of a 31-day month: global 12000*10/31 = 120000/31; hourly 1234.5;
# labor = 1234.5 + 120000/31 = 158269.5/31 = 316539/62; pct = (316539/62)/20000*100 = 316539/12400;
# profit = 20000 - 316539/62 = 923461/62.
case(id="G-25c",desc="E7/E8 labor = hourly + global calendar allocation in a 31-day month (complete window 10-01..10-10)",asOf="2026-10-11",window={"kind":"open_month","month":"2026-10"},
 expand=[rep("2026-10-01","2026-10-02",{"sales":"0","supplier_payments":{"s1":"skip"},"payroll":"0"}),rep("2026-10-04","2026-10-10",{"sales":"0","supplier_payments":{"s1":"skip"},"payroll":"0"})],
 rows=[{"id":"a","date":"2026-10-03","sales":"20000","payroll":"1234.5","supplier_payments":{"s1":"skip"}}],
 timeline=[V("auth","0000-01-01",1,{"e1":"12000"})],
 expect={"report.actual.labor.globalEmployerCost.value":"120000/31","report.actual.labor.hourlyEmployerCost.value":"1234.5",
 "report.actual.labor.employerCost":{"state":"complete","value":"316539/62","issues":[]},
 "report.actual.labor.employerCostPct.value":"316539/12400",
 "report.actual.operatingProfit":{"state":"complete","value":"923461/62","issues":[]}})
case(id="G-26",desc="percentage rent and royalty with a mid-month rate change",asOf="2026-10-01",window=CLOSED_SEPT,expand=[rep("2026-09-01","2026-09-30",{"sales":"1000"})],
 timeline=[V("v1","2026-09-01",1,rent={"mode":"pct","ratePct":"10"},roy={"mode":"pct","ratePct":"5"}),V("v2","2026-09-16",2,rent={"mode":"pct","ratePct":"8"})],
 expect={"report.actual.fixedAccrual.rentPct":"2700","report.actual.fixedAccrual.royaltyPct":"750","report.actual.fixedAccrual.total":"3450"})
case(id="G-27a",desc="month boundary: open September on the 1st has no completed day (D-1 is Aug 31)",asOf="2026-09-01",window=SEPT,
 rows=[{"id":"a","date":"2026-08-31","sales":"100"},{"id":"b","date":"2026-09-01","sales":"200"}],
 expect={"report.actual.revenue.value":None,"report.window.recognizedDays":0,"report.window.state":"no_completed_days"})
case(id="G-27a2",desc="month boundary: open September on the 2nd recognises only Sep 1",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"a","date":"2026-08-31","sales":"100"},{"id":"b","date":"2026-09-01","sales":"200"}],expect={"report.actual.revenue.value":"200","report.window.recognizedDays":1})
case(id="G-27b",desc="month boundary: closed August",asOf="2026-09-01",window={"kind":"closed_month","month":"2026-08"},
 rows=[{"id":"a","date":"2026-08-31","sales":"100"},{"id":"b","date":"2026-09-01","sales":"200"}],expect={"report.actual.revenue.value":"100","report.window.recognizedDays":31})
case(id="G-28a",desc="year boundary: open January on the 2nd",asOf="2027-01-02",window={"kind":"open_month","month":"2027-01"},
 rows=[{"id":"a","date":"2026-12-31","sales":"100"},{"id":"b","date":"2027-01-01","sales":"200"}],expect={"report.actual.revenue.value":"200"})
case(id="G-28b",desc="year boundary: closed December",asOf="2027-01-01",window={"kind":"closed_month","month":"2026-12"},
 rows=[{"id":"a","date":"2026-12-31","sales":"100"},{"id":"b","date":"2027-01-01","sales":"200"}],expect={"report.actual.revenue.value":"100"})
case(id="G-29a",desc="leap February 2028",asOf="2028-03-01",window={"kind":"closed_month","month":"2028-02"},rows=[],timeline=[V("a","0000-01-01",1,{"e":"29000"})],
 expect={"report.window.recognizedDays":29,"report.actual.labor.globalEmployerCost.value":"29000"})
case(id="G-29b",desc="non-leap February 2027",asOf="2027-03-01",window={"kind":"closed_month","month":"2027-02"},rows=[],timeline=[V("a","0000-01-01",1,{"e":"28000"})],
 expect={"report.window.recognizedDays":28,"report.actual.labor.globalEmployerCost.value":"28000"})
case(id="G-32a",desc="exception ledger wins over row flags",asOf="2026-09-06",window=SEPT,exceptionsByDate={"2026-09-05":False},
 rows=[{"id":"A","date":"2026-09-05","sales":"1","is_exception":True},{"id":"B","date":"2026-09-05","sales":"1","is_exception":False}],
 expect={"day.2026-09-05.exception":{"isException":False,"source":"ledger"}},expectFlags=[{"code":"exception_rows_disagree","date":"2026-09-05"}])
case(id="G-32b",desc="no ledger: any row flag, disagreement flagged",asOf="2026-09-06",window=SEPT,
 rows=[{"id":"A","date":"2026-09-05","sales":"1","is_exception":True},{"id":"B","date":"2026-09-05","sales":"1","is_exception":False}],
 expect={"day.2026-09-05.exception":{"isException":True,"source":"rows"}},expectFlags=[{"code":"exception_rows_disagree","date":"2026-09-05"}])
case(id="G-X1",desc="id-less legacy rows get deterministic ids, flagged",asOf="2026-09-01",window=SEPT,
 rows=[{"date":"2026-09-01","sales":"5"},{"date":"2026-09-01","sales":"5"}],expect={"day.2026-09-01.revenue.value":"10","day.2026-09-01.rowCount":2})
case(id="G-X2",desc="compat config: invalid global amount is an invalid component (never skipped); rentFixed and rent item both flagged",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],
 config={"employees":[{"id":"a","type":"global","monthlySalary":"abc"},{"id":"b","type":"hourly","monthlySalary":"9999"},{"id":"c","type":"global","monthlySalary":"3000"}],"rentType":"fixed","rentFixed":"5000"},
 fixed=[{"id":"rent","amount":"4000"},{"id":"x","amount":"100","disabled":True},{"id":"y","amount":"50","rentPct":True}],
 expect={"report.actual.labor.globalEmployerCost.state":"invalid_components","report.actual.labor.globalEmployerCost.value":None,
 "report.actual.labor.globalEmployerCost.issues.0.reason":"invalid_global_amount:a","report.actual.labor.globalEmployerCost.issues.0.component":"global_employer_cost",
 "report.actual.fixedAccrual.regular":"4000","report.actual.fixedAccrual.rentFixed":"5000"},
 expectFlags=[{"code":"invalid_global_amount","key":"a","reason":"bad_grammar"},{"code":"rent_fixed_and_rent_item_both","field":"rentFixed"},{"code":"employee_amount_not_global","key":"b"}])

# ---------- purchase basis (R1.3 G-40..G-51, revised by owner decision BD-1) ----------
PB=lambda segs,pid="PB_NET/BD-1": {"mode":"product_policy","policy":{"policyId":pid,"segments":segs}}
NET=lambda frm,vid,origin="owner_decision": {"from":frm,"kind":"net_of_vat","origin":origin,"versionId":vid}
ROW1=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"118"}}]
case(id="G-40",desc="product policy BD-1: net basis, no compatibility",asOf="2026-09-02",window={"kind":"open_month","month":"2026-09"},rows=ROW1,
 expect={"report.actual.purchases.basis.kind":"net_of_vat","report.actual.purchases.basis.compatibilityUsed":False,"report.actual.purchases.basis.policyId":"PB_NET/BD-1",
 "report.actual.purchases.basis.comparability":"same_basis_as_revenue","report.actual.purchasesPct.comparability":"same_basis_as_revenue","report.vatBasis":"net_of_vat"})
case(id="G-41",desc="historical dates are net under BD-1 (no unknown_legacy)",asOf="2019-03-02",window={"kind":"open_month","month":"2019-03"},
 rows=[{"id":"h","date":"2019-03-01","sales":"100","food_cost":"30"}],expect={"report.actual.purchases.basis.kind":"net_of_vat","report.actual.purchasesPct.value":"30"})
case(id="G-42",desc="segment mechanism: two net versions across the window",asOf="2026-09-30",window={"kind":"open_month","month":"2026-09"},
 basis=PB([NET("0000-01-01","BD-1/a"),NET("2026-09-15","BD-1/b")]),
 rows=[{"id":"a","date":"2026-09-01","sales":"100","supplier_payments":{"s1":"10"}},{"id":"b","date":"2026-09-20","sales":"100","supplier_payments":{"s1":"10"}}],
 expect={"report.actual.purchases.basis.segmentsApplied":[{"from":"0000-01-01","to":"2026-09-14","kind":"net_of_vat","origin":"owner_decision","versionId":"BD-1/a"},
 {"from":"2026-09-15","to":None,"kind":"net_of_vat","origin":"owner_decision","versionId":"BD-1/b"}],"report.actual.purchases.basis.kind":"net_of_vat"})
case(id="G-43",desc="window after the later segment uses only it",asOf="2026-09-30",window={"kind":"open_month","month":"2026-09"},
 basis=PB([NET("0000-01-01","BD-1/a"),NET("2026-09-15","BD-1/b")]),rows=[{"id":"b","date":"2026-09-20","sales":"100","supplier_payments":{"s1":"10"}}],
 expect={"report.actual.purchases.basis.segmentsApplied":[{"from":"2026-09-15","to":None,"kind":"net_of_vat","origin":"owner_decision","versionId":"BD-1/b"}]})
case(id="G-44",type="error",desc="SUPERSEDED BY BD-1: a gross basis is a contract error",asOf="2026-09-02",window={"kind":"open_month","month":"2026-09"},rows=ROW1,
 basis=PB([{"from":"0000-01-01","kind":"declared_gross","origin":"owner_decision","versionId":"x"}]),expectError="purchase_basis_not_supported")
case(id="G-45",desc="equal from: greater versionId wins, other superseded",asOf="2026-09-02",window={"kind":"open_month","month":"2026-09"},rows=ROW1,
 basis=PB([NET("0000-01-01","BD-1/1"),NET("0000-01-01","BD-1/2")]),
 expect={"report.actual.purchases.basis.segmentsApplied.0.versionId":"BD-1/2","report.actual.purchases.basis.supersededVersionIds":["BD-1/1"]})
case(id="G-46",type="error",desc="SUPERSEDED BY BD-1: per-source basis scope is a contract error",asOf="2026-09-02",window={"kind":"open_month","month":"2026-09"},rows=ROW1,
 basis=PB([dict(NET("0000-01-01","x"),scope="supplier:s1")]),expectError="purchase_basis_not_supported")
case(id="G-47",desc="attested_retroactive origin surfaced",asOf="2026-09-02",window={"kind":"open_month","month":"2026-09"},rows=ROW1,
 basis=PB([NET("0000-01-01","att-1","attested_retroactive")]),expect={"report.actual.purchases.basis.segmentsApplied.0.origin":"attested_retroactive"})
case(id="G-48",type="error",desc="missing purchaseBasis argument",asOf="2026-09-02",window={"kind":"open_month","month":"2026-09"},rows=ROW1,basis="__OMIT__",expectError="purchase_basis_required")
case(id="G-49",desc="policy leaving purchase dates uncovered: typed unresolved, amounts still reported",asOf="2026-09-02",window={"kind":"open_month","month":"2026-09"},rows=ROW1,
 basis=PB([NET("2027-01-01","late")]),
 expect={"report.actual.purchases.value":"118","report.actual.purchasesPct":{"state":"purchase_basis_unresolved"},"report.actual.purchases.basis.unresolvedDates":["2026-09-01"],"dm.2026-09-01.foodCostPct":None})
case(id="G-51",desc="no VAT arithmetic: 118 stays 118",asOf="2026-09-02",window={"kind":"open_month","month":"2026-09"},rows=ROW1,
 expect={"report.actual.purchases.value":"118","report.actual.purchasesPct.value":"11.8"})

# ---------- self-review additions (R1.4 Slice A, missing-vs-zero hardening) ----------
case(id="G-X3",desc="no stored cost configuration: global and fixed costs missing, not zero",asOf="2026-09-02",window=SEPT,config=None,
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"100"}],
 expect={"report.actual.operatingProfit.state":"incomplete_components","report.actual.operatingProfit.value":None,
 "report.actual.operatingProfit.issues":[{"component":"global_employer_cost","kind":"missing","reason":"cost_config_absent","dates":["2026-09-01"]},
  {"component":"cost_configuration","kind":"missing","reason":"cost_config_absent","dates":["2026-09-01"]}],
 "report.actual.contributionBeforeFixed":{"state":"complete","value":"600","issues":[]},"report.actual.labor.hourlyEmployerCost.value":"100",
 "report.actual.labor.employerCost":{"state":"incomplete_components","value":None,"issues":[{"component":"global_employer_cost","kind":"missing","reason":"cost_config_absent","dates":["2026-09-01"]}]},
 "report.actual.labor.employerCostPct":{"state":"incomplete_components"},"report.costVersionsApplied":[]},
 expectFlags=[{"code":"cost_config_absent","date":"2026-09-01"}])
case(id="G-X4",desc="no hourly labor recorded: employer cost missing, labor % and profit unavailable (never 0%)",asOf="2026-09-02",window=SEPT,config={},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","food_cost":"300"}],
 expect={"report.actual.labor.employerCost":{"state":"incomplete_components","value":None,"issues":[{"component":"hourly_employer_cost","kind":"missing","reason":"not_recorded","dates":["2026-09-01"]}]},
 "report.actual.labor.employerCostPct":{"state":"incomplete_components"},
 "report.actual.operatingProfit.state":"incomplete_components","report.actual.operatingProfit.value":None})
case(id="G-X5",desc="partially invalid day is present but not complete",asOf="2026-09-02",window=SEPT,
 rows=[{"id":"a","date":"2026-09-01","sales":"abc"},{"id":"b","date":"2026-09-01","sales":"0"}],
 expect={"report.actual.revenue.value":"0","report.actual.revenue.complete":False,"report.coverage.revenue.partialDays":["2026-09-01"],"report.coverage.revenue.invalidDays":[]})

# ---------- Slice A remediation R1: TI-18 typed profit (asOf = day after the tested day) ----------
ONE={"kind":"open_month","month":"2026-09"}; D2="2026-09-02"; D3="2026-09-03"
case(id="R1-A",desc="revenue present, purchases missing, labor present => profit incomplete",asOf=D2,window=ONE,config={},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","payroll":"200"}],
 expect={"report.actual.operatingProfit":{"state":"incomplete_components","value":None,"issues":[{"component":"purchases","kind":"missing","reason":"not_recorded","dates":["2026-09-01"]}]}})
case(id="R1-B",desc="purchases explicitly 0 with hourly labor => profit complete",asOf=D2,window=ONE,config={},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"0"},"payroll":"200"}],
 expect={"report.actual.operatingProfit":{"state":"complete","value":"800","issues":[]},"report.actual.contributionBeforeFixed.value":"800"})
case(id="R1-C",desc="hourly labor invalid => profit invalid_components (no number)",asOf=D2,window=ONE,config={},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"abc"}],
 expect={"report.actual.operatingProfit":{"state":"invalid_components","value":None,"issues":[{"component":"hourly_employer_cost","kind":"invalid","reason":"invalid_or_partial_value","dates":["2026-09-01"]}]},
 "report.actual.labor.employerCost.state":"invalid_components","report.actual.labor.employerCostPct":{"state":"invalid_components"}})
case(id="R1-C2",desc="partially invalid purchases (Codex adversarial) => profit invalid_components",asOf=D2,window=ONE,config={},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"100","s2":"x"},"payroll":"200"}],
 expect={"report.actual.operatingProfit.state":"invalid_components","report.actual.operatingProfit.value":None,"report.actual.purchases.value":"100"})
case(id="R1-D",desc="revenue missing, costs present => revenue_missing",asOf=D2,window=ONE,config={},
 rows=[{"id":"a","date":"2026-09-01","supplier_payments":{"s1":"300"},"payroll":"200"}],
 expect={"report.actual.operatingProfit.state":"revenue_missing","report.actual.operatingProfit.value":None})
case(id="R1-E",desc="revenue explicitly 0, all costs complete => real numeric loss (fixed 3000/30 = 100)",asOf=D2,window=ONE,config={"employees":[]},fixed=[{"id":"f","amount":"3000"}],
 rows=[{"id":"a","date":"2026-09-01","sales":"0","supplier_payments":{"s1":"50"},"payroll":"150"}],
 expect={"report.actual.operatingProfit":{"state":"complete","value":"-300","issues":[]}})
case(id="R1-F",desc="hourly employer cost not entered: labor incomplete; the global allocation never stands in for it",asOf=D2,window=ONE,config=SAL30,
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"}}],
 expect={"report.actual.labor.employerCost":{"state":"incomplete_components","value":None,"issues":[{"component":"hourly_employer_cost","kind":"missing","reason":"not_recorded","dates":["2026-09-01"]}]},
 "report.actual.labor.globalEmployerCost":{"state":"complete","value":"1000","issues":[]},
 "report.actual.operatingProfit.state":"incomplete_components","report.actual.operatingProfit.value":None})
# hourly 250 (payroll) + global 30000/30 = 1000 => 1250; hourly_payroll 50 NOT counted; pct 125; profit 1000-300-250-1000 = -550.
case(id="R1-G",desc="canonical labor = hourly (ShiftOrganizer, manual) + global allocation; provenance kept; hourly_payroll not counted",asOf=D2,window=ONE,config=SAL30,
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"250","hourly_payroll":{"w1":"50"}}],
 expect={"report.actual.labor.employerCost":{"state":"complete","value":"1250","issues":[]},"report.actual.labor.hourlyEmployerCost.value":"250",
 "report.actual.labor.source.sourceSystem":"attendance_workforce","report.actual.labor.source.sourceProduct":"ShiftOrganizer",
 "report.actual.labor.source.ingestionMethod":"manual","report.actual.labor.source.meaning":"authoritative_employer_cost",
 "report.actual.labor.source.coverage":"hourly_employees_only","report.actual.labor.source.fields":["payroll"],
 "report.actual.labor.employerCostPct.value":"125","report.actual.labor.legacyHourlyPayroll":{"counted":False,"dates":["2026-09-01"]},
 "report.actual.operatingProfit":{"state":"complete","value":"-550","issues":[]},"report.versions.labor":"MARJIN_LABOR/3","report.versions.fin":"MARJIN_FIN/3"},
 expectFlags=[{"code":"legacy_hourly_payroll_not_counted","rowId":"a","field":"hourly_payroll"}])
case(id="R1-H",desc="listed global employee without an amount => global employer cost missing (never zero)",asOf=D2,window=ONE,
 config={"employees":[{"id":"e1","type":"global","monthlySalary":""}]},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"200"}],
 expect={"report.actual.labor.globalEmployerCost":{"state":"incomplete_components","value":None,"issues":[{"component":"global_employer_cost","kind":"missing","reason":"missing_global_amount:e1","dates":["2026-09-01"]}]},
 "report.actual.labor.employerCost.state":"incomplete_components","report.actual.labor.employerCost.value":None,
 "report.actual.operatingProfit.state":"incomplete_components","report.actual.operatingProfit.value":None,
 "report.actual.contributionBeforeFixed":{"state":"complete","value":"500","issues":[]}},
 expectFlags=[{"code":"missing_global_amount","key":"e1"}])
case(id="R1-I",desc="other_expense optional: absent is fine, invalid is an invalid component",asOf=D3,window=ONE,config={},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"200"},{"id":"b","date":"2026-09-02","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"200","other_expense":"1,2"}],
 expect={"report.actual.operatingProfit.state":"invalid_components","report.actual.operatingProfit.issues":[{"component":"other_expense","kind":"invalid","reason":"invalid_or_partial_value","dates":["2026-09-02"]}],
 "report.actual.contributionBeforeFixed.state":"invalid_components"})
case(id="R1-J",desc="invalid fixed configuration => profit invalid_components",asOf=D2,window=ONE,config={},fixed=[{"id":"f","amount":"12,5"}],
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"200"}],
 expect={"report.actual.operatingProfit.state":"invalid_components","report.actual.contributionBeforeFixed":{"state":"complete","value":"500","issues":[]}})
case(id="R1-K",type="error",desc="labor source omitted => contract error",asOf=D2,window=ONE,rows=[],labor="__OMIT__",expectError="labor_source_required")
case(id="R1-L",desc="missing completed day inside the window makes profit incomplete (missing != zero)",asOf=D3,window=ONE,config={},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"200"}],
 expect={"report.actual.operatingProfit.state":"incomplete_components","report.actual.operatingProfit.value":None})
case(id="R1-M",desc="percentage rent configured without a rate: configuration missing, profit incomplete",asOf=D2,window=ONE,config={"rentType":"pct"},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"200"}],
 expect={"report.actual.operatingProfit":{"state":"incomplete_components","value":None,"issues":[{"component":"cost_configuration","kind":"missing","reason":"missing_rate:rentPct","dates":["2026-09-01"]}]}})
case(id="R1-N",desc="royalty enabled without a rate; enabled fixed item without amount: missing, not zero",asOf=D2,window=ONE,config={"hasRoyalty":True},fixed=[{"id":"f","amount":""}],
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"200"}],
 expect={"report.actual.operatingProfit.state":"incomplete_components","report.actual.operatingProfit.value":None,
 "report.actual.operatingProfit.issues":[{"component":"cost_configuration","kind":"missing","reason":"missing_fixed_amount:f,missing_rate:royaltyPct","dates":["2026-09-01"]}]})
case(id="R1-O",desc="labor % needs a complete denominator: revenue missing on one day => not a value",asOf=D3,window=ONE,config={},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"300"},"payroll":"200"},{"id":"b","date":"2026-09-02","supplier_payments":{"s1":"300"},"payroll":"200"}],
 expect={"report.actual.labor.employerCost":{"state":"complete","value":"400","issues":[]},"report.actual.labor.employerCostPct":{"state":"incomplete_components"}})
case(id="R1-P",desc="revenue invalid on every day => invalid_components (not revenue_missing)",asOf=D2,window=ONE,config={},
 rows=[{"id":"a","date":"2026-09-01","sales":"12,5","supplier_payments":{"s1":"300"},"payroll":"200"}],
 expect={"report.actual.operatingProfit.state":"invalid_components","report.actual.operatingProfit.value":None})

# ---------- FINAL owner contract 2026-09-29 (tests 1-12; O-xx) ----------
# O-01 (test 1): 30000 global in a 30-day month = 1000 per calendar day.
case(id="O-01",desc="test 1: global 30000 in a 30-day month accrues 1000 per calendar day",asOf=D2,window=ONE,config=SAL30,
 rows=[{"id":"a","date":"2026-09-01","sales":"5000","supplier_payments":{"s1":"0"},"payroll":"0"}],
 expect={"report.actual.labor.globalEmployerCost.value":"1000","dm.2026-09-01.globalLaborCost":1000})
# O-02 (tests 2,3; CD-M1 supersession): Sep 1..10 completed, Sep 5 a COMPLETED declared closure (no data).
# September eligible dates = 30 - 1 = 29, so each eligible date carries 30000/29 global and 3000/29 fixed; the
# window has 9 eligible dates: global 270000/29, fixed 27000/29, Sep 5 carries 0. revenue 9*1000; purchases 9*300;
# hourly 9*200 = 1800; labor 1800 + 270000/29 = 322200/29; profit 9000-2700-1800-270000/29-27000/29 = -166500/29.
CL5=[rep("2026-09-01","2026-09-04",FULL),rep("2026-09-06","2026-09-10",FULL)]
case(id="O-02",desc="tests 2+3 (closed-days amendment): a completed declared closure carries no monthly placement; the month's other eligible dates carry it; closed is not missing",asOf="2026-09-11",window=SEPT,
 expand=CL5,config=SAL30,fixed=[{"id":"f1","amount":"3000"}],closedDates=["2026-09-05"],
 expect={"report.actual.labor.globalEmployerCost.value":"270000/29","report.actual.fixedAccrual.regular":"27000/29","report.actual.fixedAccrual.allocation":"eligible_days_excluding_completed_closures",
 "report.actual.revenue.value":"9000","report.actual.labor.employerCost.value":"322200/29",
 "report.actual.operatingProfit":{"state":"complete","value":"-166500/29","issues":[]},
 "report.coverage.revenue.missingDays":[],"report.coverage.revenue.closedDays":["2026-09-05"],"report.coverage.revenue.expectedDays":9,
 "report.operatingCalendar":{"source":"fixture","closedDates":["2026-09-05"],"operatingDays":9}})
# O-02b (tests 2+10): same data, closure NOT declared: Sep 5 is MISSING (absent revenue is never inferred to be closed).
case(id="O-02b",desc="test 10 / closed vs missing: same data without a closure declaration => Sep 5 missing, result incomplete; costs unchanged",asOf="2026-09-11",window=SEPT,
 expand=CL5,config=SAL30,fixed=[{"id":"f1","amount":"3000"}],
 expect={"report.actual.labor.globalEmployerCost.value":"10000","report.actual.fixedAccrual.regular":"1000",
 "report.actual.operatingProfit":{"state":"incomplete_components","value":None,"issues":[
  {"component":"revenue","kind":"missing","reason":"not_recorded","dates":["2026-09-05"]},
  {"component":"purchases","kind":"missing","reason":"not_recorded","dates":["2026-09-05"]},
  {"component":"hourly_employer_cost","kind":"missing","reason":"not_recorded","dates":["2026-09-05"]}]},
 "report.coverage.revenue.missingDays":["2026-09-05"],"report.coverage.revenue.closedDays":[],"report.operatingCalendar.source":"none_declared"})
# O-04 (test 4): operating-day count never changes the month's global total.
case(id="O-04a",desc="test 4: closed September, no closures => global 30000",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],config=SAL30,
 expect={"report.actual.labor.globalEmployerCost.value":"30000"})
case(id="O-04b",desc="test 4: closed September, five declared closed days => global still 30000",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],config=SAL30,
 closedDates=["2026-09-05","2026-09-12","2026-09-19","2026-09-26","2026-09-30"],
 expect={"report.actual.labor.globalEmployerCost.value":"30000","report.operatingCalendar.operatingDays":25})
# O-05 (tests 5,6): morning of Sep 29: Actual = Sep 1..28. global 28000 (not 29000), fixed 2800, revenue 28000,
# purchases 8400, hourly 5600, labor 33600, pct 120, profit 28000-8400-5600-28000-2800 = -16800.
# The Sep 29 row (large values) is outside Actual.
O5=[rep("2026-09-01","2026-09-28",FULL)]
O5X={"report.actual.labor.globalEmployerCost.value":"28000","report.actual.fixedAccrual.regular":"2800","report.actual.revenue.value":"28000",
 "report.actual.hourlyLabor.value":"5600","report.actual.labor.employerCost.value":"33600","report.actual.labor.employerCostPct.value":"120",
 "report.actual.operatingProfit":{"state":"complete","value":"-16800","issues":[]},"report.window.from":"2026-09-01","report.window.to":"2026-09-28",
 "report.window.completedThrough":"2026-09-28","report.window.currentDay":{"date":"2026-09-29","inActual":False}}
case(id="O-05",desc="tests 5+6: morning of Sep 29 — global/fixed/revenue/labor/profit cover Sep 1-28 only; the Sep 29 row and accrual are outside Actual",
 asOf="2026-09-29",window=SEPT,expand=O5,rows=[{"id":"today","date":"2026-09-29","sales":"99999","supplier_payments":{"s1":"1"},"payroll":"99999"}],
 config=SAL30,fixed=[{"id":"f1","amount":"3000"}],expect=O5X)
# O-11 (test 11): the current day not entered at all does not make the completed MTD incomplete (same numbers).
case(id="O-11",desc="test 11: current day not entered => completed MTD still complete and identical",asOf="2026-09-29",window=SEPT,expand=O5,
 config=SAL30,fixed=[{"id":"f1","amount":"3000"}],expect=O5X)
# O-10 (test 10): no valid revenue on an expected completed day (Sep 28) => incomplete.
case(id="O-10",desc="test 10: an expected completed day without valid revenue makes the result incomplete",asOf="2026-09-29",window=SEPT,
 expand=[rep("2026-09-01","2026-09-27",FULL)],rows=[{"id":"d28","date":"2026-09-28","supplier_payments":{"s1":"300"},"payroll":"200"}],config=SAL30,
 expect={"report.actual.operatingProfit":{"state":"incomplete_components","value":None,"issues":[{"component":"revenue","kind":"missing","reason":"not_recorded","dates":["2026-09-28"]}]},
 "report.actual.labor.employerCost.value":"33600","report.actual.labor.employerCostPct":{"state":"incomplete_components"},
 "report.actual.purchasesPct":{"state":"incomplete_components"},"report.actual.fixedAccrual.state":"complete"})
# O-08 (test 8): hourly 2500 + global 1000 = daily labor 3500 (report and daily adapter).
case(id="O-08",desc="test 8: hourly ShiftOrganizer cost + global allocation = canonical daily labor",asOf=D2,window=ONE,config=SAL30,
 rows=[{"id":"a","date":"2026-09-01","sales":"10000","supplier_payments":{"s1":"0"},"payroll":"2500"}],
 expect={"report.actual.labor.employerCost":{"state":"complete","value":"3500","issues":[]},"report.actual.labor.employerCostPct.value":"35",
 "dm.2026-09-01.laborCost":3500,"dm.2026-09-01.hourlyLaborCost":2500,"dm.2026-09-01.globalLaborCost":1000,"dm.2026-09-01.laborCostComplete":True,"dm.2026-09-01.laborPct":35})
# O-09 (test 9): the global monthly amount participates directly as employer cost — no multiplier, no gross conversion.
case(id="O-09",desc="test 9: global amount 12345.67 is recognised exactly over the full month (no multiplier, no gross)",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],
 config={"employees":[{"id":"g","type":"global","monthlySalary":"12345.67"}]},
 expect={"report.actual.labor.globalEmployerCost":{"state":"complete","value":"12345.67","issues":[]},"report.actual.labor.globalEmployeesApplied":1})
# O-12 (test 12): hourly_payroll cannot silently add a second labor amount (even when invalid).
case(id="O-12",desc="test 12: hourly_payroll never adds labor; an invalid legacy value does not invalidate labor",asOf=D2,window=ONE,config={},
 rows=[{"id":"a","date":"2026-09-01","sales":"4000","supplier_payments":{"s1":"0"},"payroll":"1000","hourly_payroll":{"w1":"400","w2":"abc"}}],
 expect={"report.actual.labor.employerCost":{"state":"complete","value":"1000","issues":[]},"report.actual.hourlyLabor.value":"1000",
 "day.2026-09-01.legacyHourlyPayroll.byEmployee":{"w1":"400"},"dm.2026-09-01.laborCost":1000},
 expectFlags=[{"code":"legacy_hourly_payroll_not_counted","rowId":"a","field":"hourly_payroll"}])
case(id="O-12e",type="error",desc="test 12: declaring hourly_payroll as a labor field is a contract error",asOf=D2,window=ONE,rows=[],
 labor={"policyId":"x","meaning":"authoritative_employer_cost","sourceSystem":"attendance_workforce","sourceProduct":"ShiftOrganizer","ingestionMethod":"manual","coverage":"hourly_employees_only","fields":["payroll","hourly_payroll"]},
 expectError="legacy_labor_field_not_countable")
case(id="O-13",type="error",desc="contract B: a non-employer-cost (gross) global entry is rejected, never skipped or converted",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],
 timeline=[{"versionId":"g","effectiveFrom":"0000-01-01","recordedAt":1,"basis":"recorded","globalEmployees":[{"employeeKey":"e","kind":"gross_salary","monthlyAmount":"1"}],"fixedItems":[],"rent":{"mode":"none"},"royalty":{"mode":"none"}}],
 expectError="global_cost_not_employer_cost")
# O-14: closed day with recorded non-zero revenue contradicts the declaration => invalid; explicit zeros are consistent.
case(id="O-14",desc="closed day with recorded non-zero revenue contradicts the declaration (invalid, flagged)",asOf=D3,window=ONE,config={},closedDates=["2026-09-02"],
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"0"},"payroll":"100"},{"id":"b","date":"2026-09-02","sales":"50"}],
 expect={"report.actual.operatingProfit":{"state":"invalid_components","value":None,"issues":[{"component":"operating_calendar","kind":"invalid","reason":"closed_day_has_recorded_values","dates":["2026-09-02"]}]}},
 expectFlags=[{"code":"closed_day_has_recorded_values","date":"2026-09-02"}])
case(id="O-14z",desc="closed day with explicit zero revenue and a recorded purchase is consistent (purchase counted)",asOf=D3,window=ONE,config={},closedDates=["2026-09-02"],
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"0"},"payroll":"100"},{"id":"b","date":"2026-09-02","sales":"0","supplier_payments":{"s1":"40"}}],
 expect={"report.actual.operatingProfit":{"state":"complete","value":"860","issues":[]}})
# O-15 (CD-M1 supersession): every completed day is a completed declared closure: revenue is a known zero and the
# two closures carry no monthly placement (the month's 28 other dates — still future — carry it), so the window's
# global and fixed placements are 0 and profit = 0.
case(id="O-15",desc="all completed days closed (closed-days amendment): known zero revenue, no monthly placement on the completed closures, labor % has a zero denominator",asOf=D3,window=ONE,config=SAL30,fixed=[{"id":"f1","amount":"3000"}],
 closedDates=["2026-09-01","2026-09-02"],rows=[],
 expect={"report.actual.operatingProfit":{"state":"complete","value":"0","issues":[]},"report.actual.labor.employerCost.value":"0",
 "report.actual.labor.employerCostPct":{"state":"zero_denominator"},"report.operatingCalendar.operatingDays":0})
# self-review of the final contract: negative global amount, fixed cost typed, % rent on incomplete revenue.
case(id="O-17",desc="negative global monthly amount is invalid (never a negative employer cost)",asOf=D2,window=ONE,config={"employees":[{"id":"n","type":"global","monthlySalary":"-30000"}]},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"0"},"payroll":"100"}],
 expect={"report.actual.labor.globalEmployerCost.state":"invalid_components","report.actual.labor.employerCost.value":None,"report.actual.operatingProfit.state":"invalid_components"},
 expectFlags=[{"code":"invalid_global_amount","key":"n","reason":"negative_amount"}])
case(id="O-17e",type="error",desc="recorded timeline with a negative global amount is a contract error",asOf="2026-10-01",window=CLOSED_SEPT,rows=[],
 timeline=[V("n","0000-01-01",1,{"e":"-1"})],expectError="invalid_global_amount")
case(id="O-18",desc="fixed cost is typed: configuration starting mid-window gives no fixed amount (not a partial sum)",asOf="2026-09-20",window=SEPT,rows=[],
 timeline=[V("late","2026-09-15",1,{"e1":"30000"},{"f1":"3000"})],
 expect={"report.actual.fixedAccrual.state":"incomplete_components","report.actual.fixedAccrual.total":None,"report.actual.fixedAccrual.regular":None,
 "report.actual.fixedAccrual.issues":[{"component":"cost_configuration","kind":"missing","reason":"cost_config_absent","dates":["2026-09-01","2026-09-02","2026-09-03","2026-09-04","2026-09-05","2026-09-06","2026-09-07","2026-09-08","2026-09-09","2026-09-10","2026-09-11","2026-09-12","2026-09-13","2026-09-14"]}],
 "report.actual.labor.globalEmployerCost.state":"incomplete_components"})
case(id="O-19",desc="percentage rent on incomplete revenue: fixed cost incomplete (rate x partial revenue is never shown)",asOf=D3,window=ONE,config={"rentType":"pct","rentPct":"10"},
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"0"},"payroll":"0"}],
 expect={"report.actual.fixedAccrual.state":"incomplete_components","report.actual.fixedAccrual.rentPct":None,
 "report.actual.fixedAccrual.issues":[{"component":"revenue","kind":"missing","reason":"not_recorded","dates":["2026-09-02"]}]})
# O-20 (CD-M1 supersession): Sep 2 is a completed declared closure: its placement is 0 (complete), Sep 1 carries
# 30000/29 = 1034.4827586207 (10 dp) + hourly 100; report labor = 100 + 30000/29 = 32900/29.
case(id="O-20",desc="daily adapter (closed-days amendment): a completed declared closure has no monthly placement; the other dates carry 30000/29",asOf=D3,window=ONE,config=SAL30,closedDates=["2026-09-02"],
 rows=[{"id":"a","date":"2026-09-01","sales":"1000","supplier_payments":{"s1":"0"},"payroll":"100"}],
 expect={"dm.2026-09-02.laborCost":0,"dm.2026-09-02.laborCostComplete":True,"dm.2026-09-02.hourlyLaborCost":0,"dm.2026-09-02.globalLaborCost":0,
 "dm.2026-09-01.laborCost":1134.4827586207,"dm.2026-09-01.globalLaborCost":1034.4827586207,"report.actual.labor.employerCost.value":"32900/29"})
case(id="O-16",type="error",desc="malformed operating calendar is a contract error",asOf=D2,window=ONE,rows=[],closedDates=["2026-9-1"],expectError="invalid_operating_calendar")

json.dump({"contract":"MARJIN_FIN/3 + MARJIN_LABOR/3 + MARJIN_NORM/3 + MARJIN_DEC/1 + MARJIN_PB/1","authoredBy":"hand (R1.3/R1.4 goldens + final owner contract 2026-09-29)","cases":C},
 open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"financial-core-goldens.json"),"w"),ensure_ascii=False,indent=1)
print(len(C))
